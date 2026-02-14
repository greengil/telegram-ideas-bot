const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const categories = ['General', 'Cybersecurity', 'Technology', 'Management', 'Personal'];

async function loadData(userId) {
  try {
    const data = await fs.readFile(`./data/user_${userId}.json`, 'utf8');
    return JSON.parse(data);
  } catch {
    return { ideas: [] };
  }
}

async function saveData(userId, data) {
  try { await fs.mkdir('./data', { recursive: true }); } catch(e) {}
  await fs.writeFile(`./data/user_${userId}.json`, JSON.stringify(data, null, 2));
}

bot.onText(/\/start/, async (msg) => {
  await bot.sendMessage(msg.chat.id,