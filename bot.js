const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const schedule = require('node-schedule');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!TELEGRAM_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('❌ חסרים משתני סביבה!');
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
    return { ideas: [] };
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
    '👋 שלום! אני הבוט שלך לניהול רעיונות\n\n' +
    'שלח לי רעיון ואני אשמור אותו\n\n' +
    'פקודות:\n' +
    '/ideas - הצג רעיונות\n' +
    '/write [מספר] - כתוב מאמר\n' +
    '/export -