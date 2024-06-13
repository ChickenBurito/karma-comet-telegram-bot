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

console.log('All required environment variables are set.');

// Parse Firebase service account key from environment variable
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  console.log('Firebase service account key parsed successfully.');
} catch (error) {
  console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_KEY:', error);
  process.exit(1);
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize Firebase
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase initialized');
} catch (error) {
  console.error('Error initializing Firebase:', error);
  process.exit(1);
}

const db = admin.firestore();

// Telegram bot token from BotFather
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { 
  polling: {
    interval: 1000, // Polling interval in milliseconds (1 second)
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

console.log('Bot is starting...');

bot.onText(/\/start/, (msg) => {
  console.log('/start command received');
  bot.sendMessage(msg.chat.id, "Welcome to the KarmaComet Bot! Type /register to get started.");
});

bot.onText(/\/register (.+)/, async (msg, match) => {
  console.log('/register command received');
  const chatId = msg.chat.id;
  const userName = match[1];

  try {
    console.log(`Registering user: ${userName} with chat ID: ${chatId}`);
    await db.collection('users').doc(chatId.toString()).set({
      name: userName,
      score: 0,
      userType: 'jobSeeker', // Default user type
      subscription: {
        status: 'free',
        expiry: null
      }
    });
    console.log(`User ${userName} registered successfully.`);

    bot.sendMessage(chatId, `Hello, ${userName}! Your registration is complete. If you are a recruiter, type /setrecruiter to change your role.`);
  } catch (error) {
    console.error('Error registering user:', error);
    bot.sendMessage(chatId, 'There was an error processing your registration. Please try again.');
  }
});

bot.onText(/\/setrecruiter/, async (msg) => {
  console.log('/setrecruiter command received');
  const chatId = msg.chat.id;

  try {
    await db.collection('users').doc(chatId.toString()).update({
      userType: 'recruiter'
    });

    bot.sendMessage(chatId, "Your role has been updated to recruiter. Please type /subscribe to subscribe for recruiter services.");
  } catch (error) {
    console.error('Error setting recruiter role:', error);
    bot.sendMessage(chatId, 'There was an error updating your role. Please try again.');
  }
});

////******************////
// Log commitments
////******************////

bot.onText(/\/commit (.+)/, async (msg, match) => {
  console.log('/commit command received');
  const chatId = msg.chat.id;
  const [date, time, ...descArray] = match[1].split(' ');
  const description = descArray.join(' ');
  
  try {
    console.log(`Logging commitment for user ${chatId}: ${description} on ${date} at ${time}`);
    const docRef = await db.collection('commitments').add({
      userId: chatId.toString(),
      date,
      time,
      description,
      status: 'pending'
    });

    bot.sendMessage(chatId, `Commitment logged: ${description} on ${date} at ${time}. ID: ${docRef.id}`);
  } catch (error) {
    console.error('Error logging commitment:', error);
    bot.sendMessage(chatId, 'There was an error logging your commitment. Please try again.');
  }
});

////******************////
// Commitment status updates and scoring logic
////******************////

bot.onText(/\/status (.+)/, async (msg, match) => {
  console.log('/status command received');
  const chatId = msg.chat.id;
  const [commitmentId, status] = match[1].split(' ');

  try {
    console.log(`Updating status for commitment ${commitmentId} to ${status}`);
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
  } catch (error) {
    console.error('Error updating status:', error);
    bot.sendMessage(chatId, 'There was an error updating the status. Please try again.');
  }
});

////******************////
// Subscriptions logic
////******************////  

bot.onText(/\/subscribe/, async (msg) => {
  console.log('/subscribe command received');
  const chatId = msg.chat.id;
  const userRef = db.collection('users').doc(chatId.toString());
  const user = await userRef.get();

  if (user.exists && user.data().userType === 'recruiter') {
    try {
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
    } catch (error) {
      console.error('Error creating Stripe session:', error);
      bot.sendMessage(chatId, 'There was an error processing your subscription. Please try again.');
    }
  } else {
    bot.sendMessage(chatId, "Only recruiters need to subscribe. Please update your role using /setrecruiter if you are a recruiter.");
  }
});

////******************////
//  Send reminders logic
////******************////

const sendReminders = async () => {
  console.log('Sending reminders...');
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

    // Express app setup
const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
