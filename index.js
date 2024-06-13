require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const schedule = require('node-schedule');

// Check required environment variables
const requiredEnvVars = ['STRIPE_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'FIREBASE_SERVICE_ACCOUNT_KEY'];

requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Environment variable ${key} is required but not set.`);
  }
});

// Parse Firebase service account key from environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Telegram bot token from BotFather
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

console.log('Bot is starting...');

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome to the Commitment Bot! Type /register to get started.");
});

bot.onText(/\/register (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userName = match[1];

  await db.collection('users').doc(chatId.toString()).set({
    name: userName,
    score: 0,
    userType: 'jobSeeker', // Default user type
    subscription: {
      status: 'free',
      expiry: null
    }
  });

  bot.sendMessage(chatId, `Hello, ${userName}! Your registration is complete. If you are a recruiter, type /setrecruiter to change your role.`);
});

bot.onText(/\/setrecruiter/, async (msg) => {
    const chatId = msg.chat.id;
  
    await db.collection('users').doc(chatId.toString()).update({
      userType: 'recruiter'
    });
  
    bot.sendMessage(chatId, "Your role has been updated to recruiter. Please type /subscribe to subscribe for recruiter services.");
  });

////******************////
// the following code allows users to log commitments
////******************////

bot.onText(/\/commit (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const [date, time, ...descArray] = match[1].split(' ');
    const description = descArray.join(' ');
  
    const docRef = await db.collection('commitments').add({
      userId: chatId.toString(),
      date,
      time,
      description,
      status: 'pending'
    });
  
    bot.sendMessage(chatId, `Commitment logged: ${description} on ${date} at ${time}. ID: ${docRef.id}`);
  });

////******************////
// The following code handles commitment status updates and scoring
////******************////

bot.onText(/\/status (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const [commitmentId, status] = match[1].split(' ');
  
    const commitmentRef = db.collection('commitments').doc(commitmentId);
    const commitment = await commitmentRef.get();
  
    if (commitment.exists) {
      await commitmentRef.update({ status });
  
      const userRef = db.collection('users').doc(chatId.toString());
      const user = await userRef.get();
  
      if (user.exists) {
        let newScore = user.data().score;
        if (status === 'attended') newScore += 10;
        else if (status === 'missed') newScore -= 10;
  
        await userRef.update({ score: newScore });

        // Check for recruiter and update subscription status
      if (user.data().userType === 'recruiter' && status === 'attended' && user.data().subscription.status === 'free') {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 7);

        await userRef.update({
          subscription: {
            status: 'trial',
            expiry: expiryDate
          }
        });

        bot.sendMessage(chatId, `Your status for commitment "${commitment.data().description}" has been updated to ${status}. Your new score is ${newScore}. Your free trial period has started and will expire on ${expiryDate}.`);
    } else {
      bot.sendMessage(chatId, `Your status for commitment "${commitment.data().description}" has been updated to ${status}. Your new score is ${newScore}.`);
    }
  }
} else {
  bot.sendMessage(chatId, 'Commitment not found.');
}
});

////******************////
// The following code handles subscriptions
////******************////  

bot.onText(/\/subscribe/, async (msg) => {
    const chatId = msg.chat.id;
    const userRef = db.collection('users').doc(chatId.toString());
    const user = await userRef.get();
  
    if (user.exists && user.data().userType === 'recruiter') {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price: 'price_1PNcuLP9AlrL3WaNIocXw0Ml', // Replace with actual price ID
            quantity: 1,
          }],
          mode: 'subscription',
          success_url: 'https://your-success-url.com',
          cancel_url: 'https://your-cancel-url.com',
        });
  
      bot.sendMessage(chatId, `Please complete your subscription payment: ${session.url}`);
    } else {
      bot.sendMessage(chatId, "Only recruiters need to subscribe. Please update your role using /setrecruiter if you are a recruiter.");
    }
  });

////******************////
//  The following code allows to send reminders
////******************////

const sendReminders = async () => {
    const now = new Date();
    const commitments = await db.collection('commitments').where('status', '==', 'pending').get();
  
    commitments.forEach(async (doc) => {
      const commitment = doc.data();
      const commitmentDate = new Date(`${commitment.date} ${commitment.time}`);
  
      if (commitmentDate > now && (commitmentDate - now) <= 24 * 60 * 60 * 1000) { // Reminder 24 hours before
        bot.sendMessage(commitment.userId, `Reminder: You have a commitment "${commitment.description}" on ${commitment.date} at ${commitment.time}.`);
      }
    });
  };
  
  schedule.scheduleJob('0 * * * *', sendReminders); // Run every hour