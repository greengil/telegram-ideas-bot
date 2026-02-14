const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const schedule = require('node-schedule');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!TELEGRAM_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('❌ חסרים משתני סביבה!');
  console.log('הגדר: TELEGRAM_TOKEN ו-ANTHROPIC_API_KEY');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const categories = ['כללי', 'אבטחת סייבר', 'טכנולוגיה', 'ניהול', 'אישי'];

async function loadUserData(userId) {
  try {
    const data = await fs.readFile(`./data/user_${userId}.json`, 'utf8');
    return JSON.parse(data);
  } catch {
    return { ideas: [], preferences: { reminderDay: 1 } };
  }
}

async function saveUserData(userId, data) {
  try {
    await fs.mkdir('./data', { recursive: true });
  } catch (e) {}
  await fs.writeFile(`./data/user_${userId}.json`, JSON.stringify(data, null, 2));
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 
    '👋 שלום! אני הבוט המתקדם שלך לניהול רעיונות\n\n' +
    '📝 *תכונות עיקריות:*\n' +
    '• שלח לי רעיון ואני אשמור אותו\n' +
    '• קטגוריות לארגון הרעיונות\n' +
    '• תזכורות אוטומטיות\n' +
    '• כתיבת מאמרים אוטומטית\n\n' +
    '*פקודות:*\n' +
    '/ideas - הצג רעיונות\n' +
    '/write [מספר] - כתוב מאמר\n' +
    '/edit [מספר] - ערוך\n' +
    '/delete [מספר] - מחק\n' +
    '/export - ייצא לקובץ\n' +
    '/help - עזרה',
    { parse_mode: 'Markdown' }
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) return;

  const keyboard = {
    reply_markup: {
      inline_keyboard: categories.map(cat => [{
        text: cat,
        callback_data: `cat_${cat}_${Date.now()}`
      }])
    }
  };

  await bot.sendMessage(chatId, 
    `📌 קיבלתי את הרעיון:\n"${text}"\n\nבחר קטגוריה:`,
    keyboard
  );
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('cat_')) {
    const [_, category, timestamp] = data.split('_');
    const userId = chatId.toString();
    const userData = await loadUserData(userId);

    const originalMessage = query.message.text;
    const ideaText = originalMessage.split('\n')[1].replace(/"/g, '');

    const idea = {
      id: parseInt(timestamp),
      text: ideaText,
      date: new Date().toISOString(),
      reminded: false,
      category: category
    };

    userData.ideas.push(idea);
    await saveUserData(userId, userData);

    await bot.editMessageText(
      `✅ שמרתי את הרעיון בקטגוריה "${category}"!\n\n` +
      `יש לך כעת ${userData.ideas.length} רעיונות\n\n` +
      `כדי לכתוב מאמר: /write ${userData.ideas.length}`,
      { chat_id: chatId, message_id: query.message.message_id }
    );
  } else if (data.startsWith('delete_')) {
    const ideaNumber = parseInt(data.split('_')[1]);
    const userId = chatId.toString();
    const userData = await loadUserData(userId);

    userData.ideas.splice(ideaNumber, 1);
    await saveUserData(userId, userData);

    await bot.editMessageText(
      '🗑️ הרעיון נמחק בהצלחה',
      { chat_id: chatId, message_id: query.message.message_id }
    );
  } else if (data === 'cancel') {
    await bot.editMessageText(
      'הפעולה בוטלה',
      { chat_id: chatId, message_id: query.message.message_id }
    );
  }
});

bot.onText(/\/ideas/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = chatId.toString();
  const userData = await loadUserData(userId);
  const ideas = userData.ideas || [];

  if (ideas.length === 0) {
    await bot.sendMessage(chatId, 'עדיין אין לך רעיונות. שלח לי רעיון ראשון!');
    return;
  }

  let message = '📝 *הרעיונות שלך:*\n\n';
  ideas.forEach((idea, index) => {
    const date = new Date(idea.date).toLocaleDateString('he-IL');
    message += `${index + 1}. [${idea.category}] ${idea.text}\n`;
    message += `   📅 ${date}\n\n`;
  });

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/write (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = chatId.toString();
  const ideaNumber = parseInt(match[1]) - 1;
  const userData = await loadUserData(userId);
  
  if (ideaNumber < 0 || ideaNumber >= userData.ideas.length) {
    await bot.sendMessage(chatId, 'מספר רעיון לא תקין');
    return;
  }

  const idea = userData.ideas[ideaNumber];
  await bot.sendMessage(chatId, '✍️ כותב את המאמר...');

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `כתוב מאמר מקצועי ללינקדין בקטגוריה "${idea.category}" על סמך הרעיון: "${idea.text}"

המאמר צריך להיות:
- באורך של 3-4 פסקאות
- מקצועי אבל גם אישי
- עם תובנות מעשיות
- בעברית

כתוב רק את המאמר.`
      }]
    });

    const article = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    await bot.sendMessage(chatId, `📄 *המאמר שלך:*\n\n${article}`, { parse_mode: 'Markdown' });
  } catch (error) {
    await bot.sendMessage(chatId, 'אירעה שגיאה. נסה שוב.');
    console.error(error);
  }
});

bot.onText(/\/edit (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = chatId.toString();
  const ideaNumber = parseInt(match[1]) - 1;
  const userData = await loadUserData(userId);

  if (ideaNumber < 0 || ideaNumber >= userData.ideas.length) {
    await bot.sendMessage(chatId, 'מספר רעיון לא תקין');
    return;
  }

  const idea = userData.ideas[ideaNumber];
  await bot.sendMessage(chatId, `✏️ עורך:\n"${idea.text}"\n\nשלח טקסט חדש:`);

  const handler = async (response) => {
    if (response.chat.id === chatId && !response.text.startsWith('/')) {
      userData.ideas[ideaNumber].text = response.text;
      await saveUserData(userId, userData);
      await bot.sendMessage(chatId, '✅ עודכן!');
      bot.removeListener('message', handler);
    }
  };

  bot.on('message', handler);
});

bot.onText(/\/delete (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = chatId.toString();
  const ideaNumber = parseInt(match[1]) - 1;
  const userData = await loadUserData(userId);

  if (ideaNumber < 0 || ideaNumber >= userData.ideas.length) {
    await bot.sendMessage(chatId, 'מספר רעיון לא תקין');
    return;
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ כן, מחק', callback_data: `delete_${ideaNumber}` },
        { text: '❌ ביטול', callback_data: 'cancel' }
      ]]
    }
  };

  await bot.sendMessage(chatId, 
    `למחוק?\n"${userData.ideas[ideaNumber].text}"`,
    keyboard
  );
});

bot.onText(/\/export/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = chatId.toString();
  const userData = await loadUserData(userId);

  if (userData.ideas.length === 0) {
    await bot.sendMessage(chatId, 'אין רעיונות');
    return;
  }

  let text = `רעיונות - ${new Date().toLocaleDateString('he-IL')}\n${'='.repeat(50)}\n\n`;

  userData.ideas.forEach((idea, index) => {
    text += `${index + 1}. [${idea.category}]\n${idea.text}\n`;
    text += `תאריך: ${new Date(idea.date).toLocaleDateString('he-IL')}\n${'-'.repeat(50)}\n\n`;
  });

  const buffer = Buffer.from(text, 'utf8');
  await bot.sendDocument(chatId, buffer, {
    filename: `ideas-${Date.now()}.txt`,
    caption: '📥 הרעיונות שלך'
  });
});

schedule.scheduleJob('0 9 * * 1', async () => {
  try {
    const files = await fs.readdir('./data');
    const userFiles = files.filter(f => f.startsWith('user_'));

    for (const file of userFiles) {
      const userId = file.replace('user_', '').replace('.json', '');
      const userData = await loadUserData(userId);

      if (userData.ideas.length === 0) continue;

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const oldIdeas = userData.ideas.filter(idea => new Date(idea.date) < weekAgo);

      if (oldIdeas.length > 0) {
        let message = '🔔 *תזכורת שבועית!*\n\n';
        message += `יש לך ${oldIdeas.length} רעיונות:\n\n`;
        
        oldIdeas.slice(0, 5).forEach((idea, i) => {
          message += `${i + 1}. [${idea.category}] ${idea.text.substring(0, 50)}...\n`;
        });

        await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
      }
    }
  } catch (error) {
    console.error('שגיאה בתזכורות:', error);
  }
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    '*📚 מדריך:*\n\n' +
    '*הוספה:* שלח רעיון\n' +
    '/ideas - הצג\n' +
    '/write [מספר] - כתוב מאמר\n' +
    '/edit [מספר] - ערוך\n' +
    '/delete [מספר] - מחק\n' +
    '/export - ייצא\n\n' +
    '*קטגוריות:*\n' + categories.join(', '),
    { parse_mode: 'Markdown' }
  );
});

console.log('🤖 הבוט פועל!');
```

שמור (Ctrl+S)

---

### קובץ 3: `.gitignore`

New File → שמור בשם `.gitignore`:
```
node_modules/
data/
.env
*.json
!package.json