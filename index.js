////************************************************////
//////++///// KarmaComet Telegram Chatbot /////++//////
////**********************************************////

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const schedule = require('node-schedule');
const endpointSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
const cron = require('node-cron'); //cron is used for scheduling tasks
const moment = require('moment-timezone'); //sync users within different time-zones
moment.tz.load(require('moment-timezone/data/packed/latest.json'));
const NodeCache = require('node-cache');
const callbackCache = new NodeCache({ stdTTL: 600, checkperiod: 60 }); // Cache witbnnh a TTL of 10 minutes

// Check required environment variables
const requiredEnvVars = ['STRIPE_TEST_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'FIREBASE_SERVICE_ACCOUNT_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_TEST_WEBHOOK_SECRET', 'BOT_URL'];

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

const stripe = require('stripe')(process.env.STRIPE_TEST_SECRET_KEY);

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

// Express app setup
const app = express();
app.use(bodyParser.raw({ type: 'application/json' })); // Stripe requires the raw body to construct the event

//****IMPORTANT******// Set Not allowed commands for users with expired subscriptions //******IMPORTANT******//
const notAllowedCommands = ['/meeting'];

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

// Log every message received
bot.on('message', (msg) => {
  console.log(`Message received: ${msg.text}`);
});

// Define the commands
const commands = [
  { command: '/start', description: 'Start the KarmaComet bot' },
  { command: '/register', description: 'Register as a user' },
  { command: '/meeting', description: 'To schedule a meeting add @username and description' },
  { command: '/userinfo', description: 'See user profile' },
  { command: '/meetingstatus', description: 'Get scheduled meetings' },
  { command: '/meetinghistory', description: 'Get past meetings' },
  { command: '/feedbackstatus', description: 'Get scheduled feedbacks' },
  { command: '/feedbackhistory', description: 'Get past feedbacks' },
  { command: '/subscribe', description: 'Subscribe to the service' },
  { command: '/setrecruiter', description: 'Switch to a recruiter role.' },
  { command: '/setjobseeker', description: 'Switch to a job seeker role' },
];

// Set the bot's commands
bot.setMyCommands(commands)
  .then(() => {
    console.log('Bot commands have been set successfully.');
  })
  .catch(err => {
    console.error('Error setting bot commands:', err);
  });

// Function to check if callback query is a duplicate
const isDuplicateCallback = (callbackQueryId) => {
  return callbackCache.has(callbackQueryId);
};

  // Helper function to check if the user exists
const getUser = async (chatId) => {
  const userRef = db.collection('users').doc(chatId.toString());
  const userDoc = await userRef.get();
  return userDoc.exists ? userDoc.data() : null;
};

// Function to handle user registration
const registerUser = async (chatId, userName) => {
  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      console.log(`User ${userName} with chat ID: ${chatId} is already registered.`);
      bot.sendMessage(chatId, '🙌 You are already registered.');
    } else {
      console.log(`Registering user: ${userName} with chat ID: ${chatId}`);
      await userRef.set({
        name: userName,
        chatId: chatId,
        registered_at: new Date().toISOString(),
        KarmaPoints: 0,
        userType: 'jobSeeker', // Default user type
        isAdmin: false,
        subscription: {
          status: 'free', // Default to free
          expiry: null
        },
        stripeCustomerId: null, // Initialize Stripe customer ID as null
        stripeSubscriptionId: null, // Initialize subscription ID as null
        timeZone: null // Initialize timeZone as null
      });
      console.log(`User ${userName} with chat ID: ${chatId} registered successfully.`);
      askForTimeZone(chatId);
    }
  } catch (error) {
    console.error('Error registering user:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your registration. Please try again.');
  }
};

// Function to ask for the user's time zone
const askForTimeZone = (chatId) => {
  bot.sendMessage(chatId, "🌍 Please select your time zone:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "UTC-12:00 (Baker Island)", callback_data: "timezone_Pacific/Apia" }],
        [{ text: "UTC-11:00 (American Samoa)", callback_data: "timezone_Pacific/Pago_Pago" }],
        [{ text: "UTC-10:00 (Hawaii)", callback_data: "timezone_Pacific/Honolulu" }],
        [{ text: "UTC-09:00 (Alaska)", callback_data: "timezone_America/Anchorage" }],
        [{ text: "UTC-08:00 (Pacific Time)", callback_data: "timezone_America/Los_Angeles" }],
        [{ text: "UTC-07:00 (Mountain Time)", callback_data: "timezone_America/Denver" }],
        [{ text: "UTC-06:00 (Central Time)", callback_data: "timezone_America/Chicago" }],
        [{ text: "UTC-05:00 (Eastern Time)", callback_data: "timezone_America/New_York" }],
        [{ text: "UTC-04:00 (Atlantic Time)", callback_data: "timezone_America/Halifax" }],
        [{ text: "UTC-03:00 (Argentina)", callback_data: "timezone_America/Argentina/Buenos_Aires" }],
        [{ text: "UTC-02:00 (South Georgia)", callback_data: "timezone_Atlantic/South_Georgia" }],
        [{ text: "UTC-01:00 (Azores)", callback_data: "timezone_Atlantic/Azores" }],
        [{ text: "UTC+00:00 (London)", callback_data: "timezone_Europe/London" }],
        [{ text: "UTC+01:00 (Berlin)", callback_data: "timezone_Europe/Berlin" }],
        [{ text: "UTC+02:00 (Cairo)", callback_data: "timezone_Africa/Cairo" }],
        [{ text: "UTC+03:00 (Moscow)", callback_data: "timezone_Europe/Moscow" }],
        [{ text: "UTC+04:00 (Dubai)", callback_data: "timezone_Asia/Dubai" }],
        [{ text: "UTC+05:00 (Karachi)", callback_data: "timezone_Asia/Karachi" }],
        [{ text: "UTC+06:00 (Dhaka)", callback_data: "timezone_Asia/Dhaka" }],
        [{ text: "UTC+07:00 (Bangkok)", callback_data: "timezone_Asia/Bangkok" }],
        [{ text: "UTC+08:00 (Singapore)", callback_data: "timezone_Asia/Singapore" }],
        [{ text: "UTC+09:00 (Tokyo)", callback_data: "timezone_Asia/Tokyo" }],
        [{ text: "UTC+10:00 (Sydney)", callback_data: "timezone_Australia/Sydney" }],
        [{ text: "UTC+11:00 (Solomon Islands)", callback_data: "timezone_Pacific/Guadalcanal" }],
        [{ text: "UTC+12:00 (Fiji)", callback_data: "timezone_Pacific/Fiji" }],
      ]
    }
  });
};

//------------- Handle /start command --------------//
bot.onText(/\/start/, (msg) => {
  console.log('/start command received');
  const chatId = msg.chat.id;
  const userName = msg.from.username || 'there';

  const greeting = `Hi *${userName}* 👋`;
  const description = `
 I am *KarmaComet* Bot 🤖

 🌏 The first-ever solution to revolutionise the recruitment process for both job seekers and recruiters. 
 🤝 I ensure that all parties stay true to their commitments, helping everyone save time and money.
  
  🌟 *Key Features:*
  🟢 *Accountability:* Ensure both job seekers and recruiters keep their promises.
  🟢 *Commitment Tracking:* Log and track all your meetings and feedbacks with precise dates, times, and descriptions.
  🟢 *Automated Reminders:* Never forget a meeting or interview with our timely reminders.
  🟢 *Feedback Enforcement:* Push Recruiters and Job seekers to share timely feedback, improving transparency and trust.
  🟢 *Karma System:* Track your reliability with a scoring system based on your commitment fulfillment.
  🟢 *Subscription Services:* Recruiters can subscribe for advanced features and management tools such as popular ATS integrations and more.
  
  📋 *User Guide:*

  *Step 1:* Registration 📖
  - */register*: Register with your Telegram username.
  - */setrecruiter*: Switch your role to a recruiter to use recruiter features.
  - */setjobseeker*: Switch your role back to a job seeker if needed.

  *Step 2:* Scheduling a meeting 📅
  - */meeting @username description*\nSchedule a meeting with a job seeker using his Telegram username and a meeting title.
  
  ℹ️ *Note:* *Feedback* requests and *Reminders* will be scheduled fully *automatically* 🔁

  🔎 Check your user profile, meetings and feedbacks statuses anytime!
  - */userinfo*: Check your user profile.
  - */meetingstatus*: See full list of your scheduled meetings.
  - */feedbackstatus*: See full list of your scheduled feedbacks.
  - */meetinghistory*: See full list of your past meetings.
  - */feedbackhistory*: See full list of your past feedbacks.

  👑 If you are a recruiter don't forget to subsribe for more amazing features!
  - */subscribe*: Subscribe to recruiter services.
  
  🪬 *KarmaComet* Bot is here to streamline the recruitment process, ensuring every meeting, interview, and feedback session happens on time and as planned. Let's make recruitment more efficient and reliable!
  
  💥 Ready to try it out?`;

  bot.sendMessage(chatId, greeting, { parse_mode: 'Markdown' });
  bot.sendMessage(chatId, description, { parse_mode: 'Markdown' });

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⎯⎯ Register ⎯⎯', callback_data: 'register' }]
      ]
    },
    parse_mode: 'Markdown'
  };

  bot.sendMessage(chatId, '⬇⬇ Click *Register* button to begin ⬇⬇', opts);
});

// Handle callback query for registration and role selection
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  const callbackQueryId = callbackQuery.id;

  // Check if the callback query ID is already in the cache
  if (callbackCache.has(callbackQueryId)) {
    console.log(`Duplicate callback query received: ${callbackQueryId}`);
    return;
  }

  // Store the callback query ID in the cache
  callbackCache.set(callbackQueryId, true);

  if (data === 'register') {
    const userName = callbackQuery.from.username || 'User'; // Use callbackQuery.from.username
    await registerUser(chatId, userName);
    return; // Early return to prevent further execution
  } else if (data.startsWith('timezone_')) {
    const timeZone = data.split('_')[1];

    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();

    if (userDoc.exists && !userDoc.data().timeZone) { // Check if timezone is not already set
      await userRef.update({
        timeZone: timeZone
      });

      bot.sendMessage(chatId, `🕑 Your time zone has been set to ${timeZone}.`);
      bot.sendMessage(chatId, `✅ *${userDoc.data().name}*, your registration is complete!`, { parse_mode: 'Markdown' });

      // Buttons to change role to recruiter or continue as job seeker
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👨‍💼 Change role to recruiter', callback_data: 'prompt_setrecruiter' }],
            [{ text: '🔍 Continue as job seeker', callback_data: 'continue_jobseeker' }]
          ]
        }
      };
      bot.sendMessage(chatId, 'Would you like to change your role to recruiter 👨‍💻 or continue as a job seeker 🔍 ?', opts);
    } else {
      bot.sendMessage(chatId, '🙌 You have already set your time zone.');
    }
    return; // Early return to prevent further execution
  }

  if (data === 'prompt_setrecruiter') {
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🥷 Individual', callback_data: 'recruiter_individual' },
            { text: '📇 Company', callback_data: 'recruiter_company' }
          ]
        ]
      }
    };
    bot.sendMessage(chatId, '👨‍💻 Are you an individual recruiter or registering as a company?', opts);
  } else if (data === 'continue_jobseeker') {
    bot.sendMessage(chatId, 'You have chosen to continue as a job seeker.');
  } else if (data === 'recruiter_individual' || data === 'recruiter_company') {
    await handleRecruiterType(callbackQuery);
  }
});

// Function to handle recruiter type selection
const handleRecruiterType = async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  if (data === 'recruiter_individual') {
    try {
      await db.collection('users').doc(chatId.toString()).update({
        userType: 'recruiter',
        recruiterType: 'individual',
        'subscription.status': 'free', // Ensure subscription status is free initially
        'subscription.expiry': null // No expiry date initially
      });
      bot.sendMessage(chatId, '✅ You are now registered as an *individual recruiter*.\n🚀 It is time to schedule your first meeting!\n\n➡ Type */meeting @username {meeting description}* where {username} is the telegram username of the Job seeker and {meeting description} is any meeting details you want to provide.\n\nIf you want to switch back to *Job Seeker* role just type */setjobseeker*.', { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error setting recruiter role:', error);
      bot.sendMessage(chatId, '🛠 There was an error updating your role. Please try again.');
    }
  } else if (data === 'recruiter_company') {
    bot.sendMessage(chatId, 'Please enter your *company name* using the format: */company {company name}*', { parse_mode: 'Markdown' });
  }
};

//--------------- Handle /register command ------------------//
bot.onText(/\/register/, async (msg) => {
  console.log('/register command received');
  const chatId = msg.chat.id;
  const userName = msg.from.username || 'User';

  await registerUser(chatId, userName);
});

//--------------- Handle /setrecruiter command ---------------//
bot.onText(/\/setrecruiter/, async (msg) => {
  console.log('/setrecruiter command received');
  const chatId = msg.chat.id;

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🥷 Individual', callback_data: 'recruiter_individual' },
          { text: '📇 Company', callback_data: 'recruiter_company' }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, '👨‍💻 Are you an individual recruiter or registering as a company?', opts);
});

//--------------- Handle company name input ----------------//
bot.onText(/\/company (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const companyName = match[1];

  try {
    await db.collection('users').doc(chatId.toString()).update({
      userType: 'recruiter',
      recruiterType: 'company',
      companyName: companyName
    });
    bot.sendMessage(chatId, `✅ You are now registered as a company recruiter for *${companyName}*\n🚀 It is time to schedule your *first meeting!*\n\n➡ Type */meeting @username {meeting description}* where {username} is the Telegram username of the Job seeker and {meeting description} is any meeting title.\n\nIf you want to switch back to *Job Seeker* role just type */setjobseeker*.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error setting company recruiter role:', error);
    bot.sendMessage(chatId, '🛠 There was an error updating your role. Please try again.');
  }
});

//------------ Handle /setjobseeker command -------------//
bot.onText(/\/setjobseeker/, async (msg) => {
  console.log('/setjobseeker command received');
  const chatId = msg.chat.id;

  try {
    const user = await getUser(chatId);

    if (user) {
      if (user.userType === 'jobSeeker') {
        bot.sendMessage(chatId, "🙌 You are already a job seeker.");
      } else {
        await db.collection('users').doc(chatId.toString()).update({
          userType: 'jobSeeker'
        });

        bot.sendMessage(chatId, ' ✅ Your role has been updated to *job seeker*\n\nYour recruiter *subscription status remains unchanged* until expiration date.\nPlease note that in order to use recruiter role features you will need to switch back to *recruiter role*.', { parse_mode: 'Markdown' });
      }
    }
  } catch (error) {
    console.error('Error setting job seeker role:', error);
    bot.sendMessage(chatId, '🛠 There was an error updating your role. Please try again.');
  }
});

// List of authorized user IDs or usernames for testing commands
const resetAuthorizedUsers = ['klngnv','kriskolgan']; // Add your username or user ID here

//----------- Handle /reset command for testing purposes -----------//
bot.onText(/\/reset/, async (msg) => {
  console.log('/reset command received');
  const chatId = msg.chat.id;
  const userName = msg.from.username || 'User';

  // Check if the user is authorized
  if (!resetAuthorizedUsers.includes(userName)) {
    bot.sendMessage(chatId, '🚧 You are not authorized to use this command.');
    return;
  }

  try {
    console.log(`Resetting user: ${userName} with chat ID: ${chatId}`);
    await db.collection('users').doc(chatId.toString()).set({
      name: userName,
      chatId: chatId,
      registered_at: new Date().toISOString(),
      KarmaPoints: 0,
      userType: 'jobSeeker', // Reset to default user type
      isAdmin: false,
      subscription: {
        status: 'free',
        expiry: null
      },
      timeZone: 'UTC' // Default to UTC time zone
    });
    console.log(`User ${userName} with chat ID ${chatId} reset successfully.`);

    bot.sendMessage(chatId, `🧹 Your status has been reset.\nYou are now a job seeker with a free subscription.\nYou can change your role to recruiter if needed using /setrecruiter command.`);
  } catch (error) {
    console.error('Error resetting user:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your reset request. Please try again.');
  }
});

////************************************************////
//++// Direct Messaging and Broadcasting Commands//++//
////**********************************************////

// Function to send a direct message to a user
const sendDirectMessage = async (chatId, message) => {
  try {
    await bot.sendMessage(chatId, message);
    console.log(`Message sent to ${chatId}`);
  } catch (error) {
    console.error(`Error sending message to ${chatId}:`, error);
  }
};

// Function to broadcast a message to all users
const broadcastMessage = async (message) => {
  try {
    const usersRef = db.collection('users');
    const usersSnapshot = await usersRef.get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const chatId = userDoc.id;
      
      if (userData.userType === 'recruiter' || userData.userType === 'jobseeker') {
        await sendDirectMessage(chatId, message);
      }
    }
    
    console.log('Broadcast message sent to all users');
  } catch (error) {
    console.error('Error broadcasting message:', error);
  }
};

//------ Handle /broadcast command (!!!admin only!!!) --------//
//-- NOTE: set "isAmdmin" to "true" only trough Firebase DB --//
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const message = match[1];

  // Check if user is admin
  const userRef = db.collection('users').doc(chatId.toString());
  const userDoc = await userRef.get();
  
  if (userDoc.exists && userDoc.data().isAdmin) {
    await broadcastMessage(message);
    bot.sendMessage(chatId, '📡 Broadcast message sent.');
  } else {
    bot.sendMessage(chatId, '🚧 You do not have permission to send broadcast messages.');
  }
});

//------- Handle /directmessage command (!!!admin only!!!) ---------//
bot.onText(/\/directmessage (\d+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const targetChatId = match[1];
  const message = match[2];

  // Check if user is admin
  const userRef = db.collection('users').doc(chatId.toString());
  const userDoc = await userRef.get();

  if (userDoc.exists && userDoc.data().isAdmin) {
    await sendDirectMessage(targetChatId, message);
    bot.sendMessage(chatId, `📬 Message sent to ${targetChatId}.`);
  } else {
    bot.sendMessage(chatId, '🚧 You do not have permission to send direct messages.');
  }
});

////**********************************************************////
//++// Handle meeting and feedback requests and commitments //++//
////********************************************************////

//------------------ Handle /meeting command --------------------//
bot.onText(/\/meeting @(\w+) (.+)/, async (msg, match) => {
  console.log('/meeting command received');
  const chatId = msg.chat.id;
  const command = '/meeting'; // Define the command here

  // Check subscription status
  const isAllowed = await checkSubscriptionStatus(chatId, command);
  if (!isAllowed) return;

  const [counterpartUsername, description] = match.slice(1);

  try {
    // Check if the user is a recruiter
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();

    if (!userDoc.exists || userDoc.data().userType !== 'recruiter') {
      bot.sendMessage(chatId, '❗ Only recruiters can create meetings. Please update your role using /setrecruiter if you are a recruiter.');
      return;
    }

    // Proceed with finding the counterpart only if the user is a recruiter
    const counterpartRef = await db.collection('users').where('name', '==', counterpartUsername).get();

    if (!counterpartRef.empty) {
      const counterpart = counterpartRef.docs[0];
      const counterpartId = counterpart.id;
      const counterpartTimeZone = counterpart.data().timeZone || 'UTC';
      console.log(`Counterpart found: ${counterpartUsername} with ID: ${counterpartId}`);
    
      const userTimeZone = userDoc.data().timeZone || 'UTC';
      const recruiterCompanyName = msg.from.company_name || '';
      const recruiterName = msg.from.username;
    
      // Generate a unique meeting request ID
      const meetingRequestId = `${Date.now()}${Math.floor((Math.random() * 1000) + 1)}`;
    
      //------------ Store the meeting request in Firestore -----------//
      await db.collection('meetingRequests').doc(meetingRequestId).set({
        recruiter_name: recruiterName,
        recruiter_company_name: recruiterCompanyName,
        recruiter_id: chatId,
        counterpart_id: counterpartId,
        counterpart_name: counterpartUsername,
        meeting_request_id: meetingRequestId,
        created_at: new Date().toISOString(),
        timeslots: [],
        description: description,
        request_submitted: false,
        counterpart_accepted: false,
        meeting_duration: null, // Initialize meeting duration
        user_time_zone: userTimeZone,
        counterpart_time_zone: counterpartTimeZone
      });
      console.log(`Meeting request stored in Firestore for meeting request ID: ${meetingRequestId} in chat ID: ${chatId}`);    

      // Ask user to choose meeting duration
      const durations = ['30 minutes', '45 minutes', '1 hour', '1.5 hours', '2 hours'];

      const opts = {
        reply_markup: {
          inline_keyboard: durations.map(duration => [
            { text: duration, callback_data: `choose_duration_meeting_${meetingRequestId}_${duration}` }
          ])
        }
      };

      bot.sendMessage(chatId, '⏳ Please choose the duration for the meeting:', opts);
    } else {
      console.log(`User @${counterpartUsername} not found.`);
      bot.sendMessage(chatId, `🤷 User @${counterpartUsername} not found.`);
    }
  } catch (error) {
    console.error('Error handling /meeting command:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your request. Please try again.');
  }
});

// Handle callback for choosing time slots and other meeting-related actions
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const callbackQueryId = callbackQuery.id;
  const callbackData = callbackQuery.data;
  const data = callbackData.split('_');

  console.log(`Received callback query with ID: ${callbackQueryId}, data: ${callbackData}`);

  // Check if the callback query ID is already in the cache
  if (callbackCache.has(callbackQueryId)) {
    console.log(`Duplicate callback query received: ${callbackQueryId}`);
    await bot.answerCallbackQuery(callbackQueryId); // Acknowledge the callback query
    return;
  }

  // Store the callback query ID in the cache
  callbackCache.set(callbackQueryId, true);

  try {
    if (data[0] === 'choose' && data[1] === 'duration' && data[2] === 'meeting') {
      const meetingRequestId = data[3];
      const durationText = data.slice(4).join(' '); // Join the rest of the array to get the full duration text
      console.log(`Duration chosen: ${durationText}, Meeting Request ID: ${meetingRequestId} for chat ID: ${chatId}`);

      let durationInMinutes;
      switch (durationText) {
        case '30 minutes':
          durationInMinutes = 30;
          break;
        case '45 minutes':
          durationInMinutes = 45;
          break;
        case '1 hour':
          durationInMinutes = 60;
          break;
        case '1.5 hours':
          durationInMinutes = 90;
          break;
        case '2 hours':
          durationInMinutes = 120;
          break;
        default:
          durationInMinutes = 60; // Default to 1 hour if unknown duration
      }

      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      await requestRef.update({ meeting_duration: durationText, duration_in_minutes: durationInMinutes });

      // Ask user to choose date
      const dates = [];
      const now = new Date();
      for (let i = 0; i < 14; i++) {
        const date = new Date(now);
        date.setDate(now.getDate() + i);
        dates.push(date.toISOString().split('T')[0]); // Format YYYY-MM-DD
      }

      const opts = {
        reply_markup: {
          inline_keyboard: dates.map(date => [
            { text: date, callback_data: `choose_date_meeting_${meetingRequestId}_${date}` }
          ]).concat([[{ text: '✉ Submit Meeting Request', callback_data: `submit_meeting_${meetingRequestId}` }], [{ text: '✖ Cancel', callback_data: `cancel_meeting_${meetingRequestId}` }]])
        }
      };

      bot.sendMessage(chatId, '📅 Please choose the date for the meeting:', opts);

    } else if (data[0] === 'choose' && data[1] === 'date' && data[2] === 'meeting') {
      const date = data[4];
      const meetingRequestId = data[3];
      console.log(`Date chosen: ${date}, Meeting Request ID: ${meetingRequestId} for chat ID: ${chatId}`);

      const availableTimes = [];
      for (let hour = 9; hour <= 19; hour++) {
        availableTimes.push(`${hour}:00`, `${hour}:30`);
      }

      const opts = {
        reply_markup: {
          inline_keyboard: availableTimes.map(time => [
            { text: time, callback_data: `add_timeslot_meeting_${meetingRequestId}_${date}_${time}` }
          ])
        }
      };

      bot.sendMessage(chatId, `🗓 Please choose up to 3 available time slots for ${date}:`, opts);

    } else if (data[0] === 'add' && data[1] === 'timeslot' && data[2] === 'meeting') {
      const meetingRequestId = data[3];
      const date = data[4];
      const time = data[5];
      console.log(`Time slot chosen: ${date} ${time}, Meeting Request ID: ${meetingRequestId} for chat ID: ${chatId}`);

      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const timeSlots = request.data().timeslots;

        if (timeSlots.length < 3) {
          timeSlots.push(`${date} ${time}`);
          await requestRef.update({ timeslots: timeSlots });

          bot.sendMessage(chatId, `✅ Added time slot: ${date} ${time}`);

          if (timeSlots.length >= 1) {
            // Ask user if they want to create the meeting request
            const opts = {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✉ Submit Meeting Request', callback_data: `submit_meeting_${meetingRequestId}` }],
                  [{ text: '✖ Cancel', callback_data: `cancel_meeting_${meetingRequestId}` }]
                ]
              }
            };
            bot.sendMessage(chatId, '📨 Do you want to submit the meeting request now?', opts);
          }
        } else {
          bot.sendMessage(chatId, '❗You have already selected 3 time slots.');
        }
      } else {
        bot.sendMessage(chatId, `🤷 Meeting request not found for ID: ${meetingRequestId}`);
      }

    } else if (data[0] === 'submit' && data[1] === 'meeting') {
      const meetingRequestId = data[2];

      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const { recruiter_id, counterpart_id, description, timeslots, recruiter_name, counterpart_name, meeting_duration, duration_in_minutes, user_time_zone, counterpart_time_zone } = request.data();

        // Validate that at least one date and one time slot are selected
        if (timeslots.length === 0) {
          bot.sendMessage(chatId, '❗ Please choose at least one date and one time slot before submitting the meeting request.');
          return;
        }

        // Convert time slots to the counterpart's time zone
        const convertedTimeslots = timeslots.map(slot => {
          const dateTime = moment.tz(slot, 'YYYY-MM-DD HH:mm', user_time_zone);
          return dateTime.clone().tz(counterpart_time_zone).format('YYYY-MM-DD HH:mm');
        });

        // Update request_submitted to true
        await requestRef.update({ request_submitted: true });

        // Send meeting request to counterpart
        await bot.sendMessage(counterpart_id, `📬 You have a meeting request from *@${recruiter_name}*\n*Description:* ${description}.\n*Meeting duration:* ${meeting_duration}.\n\n📎 Please choose one of the available time slots:`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: convertedTimeslots.map(slot => [
              { text: `📌 ${slot}`, callback_data: `accept_meeting_${meetingRequestId}_${slot}` }
            ]).concat([[{ text: '✖ Decline', callback_data: `decline_meeting_${meetingRequestId}` }]])
          }
        });

        bot.sendMessage(chatId, `✅ Meeting request sent to @${counterpart_name}.`);

      } else {
        bot.sendMessage(chatId, '🤷 Meeting request not found.');
      }

    } else if (data[0] === 'cancel' && data[1] === 'meeting') {
      const meetingRequestId = data[2];

      await db.collection('meetingRequests').doc(meetingRequestId).delete();
      bot.sendMessage(chatId, '⭕ Meeting request cancelled.');

    } else if (data[0] === 'accept' && data[1] === 'meeting') {
      const meetingRequestId = data[2];
      const selectedTimeSlot = data.slice(3).join(' ');

      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const { recruiter_id, counterpart_id, meeting_duration, duration_in_minutes, user_time_zone, counterpart_time_zone, accepted } = request.data();

        if (accepted) {
          bot.sendMessage(chatId, '🙅 This meeting has already been accepted.');
          return;
        }

        if (selectedTimeSlot && typeof selectedTimeSlot === 'string') {
          // Convert selected time slot to UTC
          const meetingStartTime = moment.tz(selectedTimeSlot, 'YYYY-MM-DD HH:mm', counterpart_time_zone).utc();
          const meetingEndTime = meetingStartTime.clone().add(duration_in_minutes, 'minutes').toISOString();

          // Mark the meeting as accepted
          await requestRef.update({ accepted: true });

          const meetingCommitmentId = `${Date.now()}${Math.floor((Math.random() * 100) + 1)}`;
          await db.collection('meetingCommitments').doc(meetingCommitmentId).set({
            recruiter_name: request.data().recruiter_name,
            recruiter_company_name: request.data().recruiter_company_name,
            recruiter_id: request.data().recruiter_id,
            counterpart_id: request.data().counterpart_id,
            counterpart_name: request.data().counterpart_name,
            meeting_request_id: meetingRequestId,
            meeting_commitment_id: meetingCommitmentId,
            created_at: request.data().created_at,
            accepted_at: new Date().toISOString(),
            meeting_scheduled_at: meetingStartTime.toISOString(),
            meeting_end_time: meetingEndTime,
            description: request.data().description,
            recruiter_commitment_state: 'pending_meeting',
            counterpart_commitment_state: 'pending_meeting',
            meeting_duration: meeting_duration,
            duration_in_minutes: duration_in_minutes,
            user_time_zone: user_time_zone,
            counterpart_time_zone: counterpart_time_zone
          });

          // Convert back to user's time zone for display
          const recruiterMeetingTime = meetingStartTime.clone().tz(user_time_zone).format('YYYY-MM-DD HH:mm');
          const counterpartMeetingTime = meetingStartTime.clone().tz(counterpart_time_zone).format('YYYY-MM-DD HH:mm');

          // Notify both parties
          bot.sendMessage(recruiter_id, `🎉 Your meeting request has been accepted by @${request.data().counterpart_name}.\n\n📍 Meeting is scheduled at ${recruiterMeetingTime}.`);
          bot.sendMessage(counterpart_id, `🎉 You have accepted the meeting request from @${request.data().recruiter_name}.\n\n📍 Meeting is scheduled at ${counterpartMeetingTime}.`);

          //-------------- Schedule feedback request generation 30 minutes after meeting end ----------//
          const feedbackRequestTime = moment(meetingEndTime).add(30, 'minutes').toDate();

          const job = schedule.scheduleJob(feedbackRequestTime, async () => {
            try {
              const commitmentRef = db.collection('meetingCommitments').doc(meetingCommitmentId);
              const commitment = await commitmentRef.get();

              if (commitment.exists) {
                const feedbackRequestId = `${Date.now()}${Math.floor((Math.random() * 1000) + 1)}`;
                const feedbackCreatedAt = new Date().toISOString();

                await db.collection('feedbackRequests').doc(feedbackRequestId).set({
                  feedback_request_id: feedbackRequestId,
                  recruiter_id: recruiter_id,
                  recruiter_name: request.data().recruiter_name,
                  counterpart_id: counterpart_id,
                  counterpart_name: request.data().counterpart_name,
                  feedback_request_created_at: feedbackCreatedAt,
                  meeting_request_id: meetingRequestId,
                  meeting_commitment_id: meetingCommitmentId,
                  days_to_feedback: null,
                  feedback_scheduled_at: null,
                  feedback_submitted: false
                });

                const daysOpts = {
                  reply_markup: {
                    inline_keyboard: [
                      ...[1, 2, 3, 4, 5, 6, 7].map(days => [
                        { text: `${days} day${days > 1 ? 's' : ''}`, callback_data: `set_feedback_days_${feedbackRequestId}_${days}` }
                      ]),
                      [{ text: '✖ Cancel', callback_data: `cancel_feedback_${feedbackRequestId}` }]
                    ]
                  }
                };

                bot.sendMessage(recruiter_id, `📆 Please specify the *number of days* you will take to provide feedback for the meeting "${commitment.data().description}":`, { parse_mode: 'Markdown' }, daysOpts);
              }
            } catch (error) {
              console.error('Error scheduling feedback request:', error);
            }
          });

          //-------- Activate trial if subscription is free and meeting is accepted ---------//
          const userRef = db.collection('users').doc(recruiter_id.toString());
          const userDoc = await userRef.get();
          if (userDoc.exists && userDoc.data().subscription.status === 'free') {
            // Get the current date
            const trialExpiryDate = new Date();

            // Add 14 days to the current date to set the trial expiration date
            trialExpiryDate.setDate(trialExpiryDate.getDate() + 14);

            // Update the user's subscription status to 'trial' and set the expiration date
            await userRef.update({
              'subscription.status': 'trial',
              'subscription.expiry': trialExpiryDate.toISOString()
            });

            // Notify the user about their trial subscription activation
            bot.sendMessage(recruiter_id, `🚀 Your *trial subscription* is now active for *14 days*, expiring on ${moment(trialExpiryDate).format('YYYY-MM-DD HH:mm', { parse_mode: 'Markdown' })}.`);
          }
        } else {
          bot.sendMessage(chatId, '🙅 Invalid time slot selected.');
        }
      } else {
        bot.sendMessage(chatId, '🤷 Meeting request not found.');
      }

    } else if (data[0] === 'decline' && data[1] === 'meeting') {
      const meetingRequestId = data[2];

      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const { recruiter_id } = request.data();

        // Update counterpart_accepted to false
        await requestRef.update({ counterpart_accepted: false });

        // Notify initiator
        bot.sendMessage(recruiter_id, `⭕ Your meeting request has been declined by @${request.data().counterpart_name}.`);

        bot.sendMessage(chatId, '⭕ You have declined the meeting request.');

      } else {
        bot.sendMessage(chatId, '🤷 Meeting request not found.');
      }

    } else if (data[0] === 'set' && data[1] === 'feedback' && data[2] === 'days') {
      const feedbackRequestId = data[3];
      const daysToFeedback = parseInt(data[4], 10);

      const feedbackRequestRef = db.collection('feedbackRequests').doc(feedbackRequestId);
      const feedbackRequest = await feedbackRequestRef.get();

      if (feedbackRequest.exists) {
        const feedbackCreatedAt = feedbackRequest.data().feedback_request_created_at;
        const feedbackScheduledAt = moment(feedbackCreatedAt).add(daysToFeedback, 'days').toISOString();

        await feedbackRequestRef.update({ days_to_feedback: daysToFeedback, feedback_scheduled_at: feedbackScheduledAt });

        // Send feedback request to job seeker
        await bot.sendMessage(feedbackRequest.data().counterpart_id, `📬 You have a feedback request from *@${feedbackRequest.data().recruiter_name}*\n*Description:* ${feedbackRequest.data().description}.\n*Feedback due in:* ${daysToFeedback} day(s).\n\n📎 Please approve or decline the feedback request:`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Approve', callback_data: `approve_feedback_${feedbackRequestId}` }],
              [{ text: '✖ Decline', callback_data: `decline_feedback_${feedbackRequestId}` }]
            ]
          }
        });

        bot.sendMessage(feedbackRequest.data().recruiter_id, `✅ Feedback request sent to @${feedbackRequest.data().counterpart_name}.`);

      } else {
        bot.sendMessage(feedbackRequest.data().recruiter_id, '🤷 Feedback request not found.');
      }

    } else if (data[0] === 'cancel' && data[1] === 'feedback') {
      const feedbackRequestId = data[2];

      const feedbackRequestRef = db.collection('feedbackRequests').doc(feedbackRequestId);
      const feedbackRequest = await feedbackRequestRef.get();

      if (feedbackRequest.exists) {
        await feedbackRequestRef.delete();

        const { recruiter_id, counterpart_id } = feedbackRequest.data();

        bot.sendMessage(recruiter_id, '⭕ Your feedback request was cancelled.');
        bot.sendMessage(counterpart_id, '⭕ The feedback request was cancelled.');

      } else {
        bot.sendMessage(chatId, '🤷 Feedback request not found.');
      }

    } else if (data[0] === 'approve' && data[1] === 'feedback') {
      const feedbackRequestId = data[2];

      const feedbackRequestRef = db.collection('feedbackRequests').doc(feedbackRequestId);
      const feedbackRequest = await feedbackRequestRef.get();

      if (feedbackRequest.exists) {
        const { recruiter_id, counterpart_id, recruiter_name, counterpart_name, meeting_request_id, meeting_commitment_id, feedback_scheduled_at } = feedbackRequest.data();

        await feedbackRequestRef.update({ feedback_submitted: true });

        // Create feedback commitment
        const feedbackCommitmentId = `${Date.now()}${Math.floor((Math.random() * 100) + 1)}`;
        await db.collection('feedbackCommitments').doc(feedbackCommitmentId).set({
          feedback_commitment_id: feedbackCommitmentId,
          feedback_request_id: feedbackRequestId,
          recruiter_id: recruiter_id,
          recruiter_name: recruiter_name,
          counterpart_id: counterpart_id,
          counterpart_name: counterpart_name,
          meeting_request_id: meeting_request_id,
          meeting_commitment_id: meeting_commitment_id,
          feedback_scheduled_at: feedback_scheduled_at,
          recruiter_commitment_state: 'pending_feedback',
          counterpart_commitment_state: 'pending_feedback'
        });

        bot.sendMessage(recruiter_id, `📝 The feedback commitment has been created and is due on ${new Date(feedback_scheduled_at).toLocaleString()}.`);
        bot.sendMessage(counterpart_id, '✅ Feedback request approved.');

      } else {
        bot.sendMessage(chatId, '🤷 Feedback request not found.');
      }

    } else if (data[0] === 'decline' && data[1] === 'feedback') {
      const feedbackRequestId = data[2];

      const feedbackRequestRef = db.collection('feedbackRequests').doc(feedbackRequestId);
      const feedbackRequest = await feedbackRequestRef.get();

      if (feedbackRequest.exists) {
        await feedbackRequestRef.delete();

        bot.sendMessage(feedbackRequest.data().recruiter_id, '⭕ Your feedback request was declined by the job seeker.');
        bot.sendMessage(chatId, '⭕ You have declined the feedback request.');

      } else {
        bot.sendMessage(chatId, '🤷 Feedback request not found.');
      }
    }
  } catch (error) {
    console.error('Error processing callback query:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your request. Please try again.');
  } finally {
    // Reset the cache for this callback query ID to allow further steps
    callbackCache.del(callbackQueryId);
    await bot.answerCallbackQuery(callbackQueryId); // Acknowledge the callback query
  }
});


////*************************************////
// Users, Meetings and Feedback status check
////************************************////

//-------------- Handle /userinfo command ----------------//
bot.onText(/\/userinfo/, async (msg) => {
  console.log('/userinfo command received');
  const chatId = msg.chat.id;

  try {
    const userData = await getUser(chatId);

    if (userData) {
      const userTimeZone = userData.timeZone || 'UTC';
      const registeredAt = moment.tz(userData.registered_at, userTimeZone).format('YYYY-MM-DD HH:mm');

      // Properly escape special characters for Markdown
      const escapeMarkdown = (text) => {
        return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
      };

      let responseMessage = `*Username:* ${escapeMarkdown(userData.name)}\n`;
      responseMessage += `*Member since:* ${registeredAt}\n`;
      responseMessage += `*User Type:* ${escapeMarkdown(userData.userType)}\n`;
      responseMessage += `*Recruiter Type:* ${escapeMarkdown(userData.recruiterType || 'N/A')}\n`;
      responseMessage += `*Subscription Status:* ${escapeMarkdown(userData.subscription.status)}\n`;
      responseMessage += `*Subscription Expiry Date:* ${userData.subscription.expiry ? moment.tz(userData.subscription.expiry, userTimeZone).format('YYYY-MM-DD HH:mm') : 'N/A'}\n`;
      responseMessage += `*Karma Score:* ${userData.KarmaPoints}\n`;
      responseMessage += `*Company Name:* ${escapeMarkdown(userData.companyName || 'N/A')}\n`;
      responseMessage += `*Time Zone:* ${escapeMarkdown(userData.timeZone || 'UTC')}\n`;

      bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Error handling /userinfo command:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your request | Please try again.');
  }
});

//----------------- Handle /meetingstatus command ----------------//
bot.onText(/\/meetingstatus/, async (msg) => {
  console.log('/meetingstatus command received');
  const chatId = msg.chat.id;

  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      bot.sendMessage(chatId, '🤷 User not found. Please register using /register.');
      return;
    }
    const userTimeZone = userDoc.data().timeZone || 'UTC';
    const now = moment.tz(userTimeZone); // Use moment to get current time in user's time zone
    console.log(`Current time in user's time zone (${userTimeZone}): ${now.format('YYYY-MM-DD HH:mm:ss')}`);

    const recruiterMeetingsSnapshot = await db.collection('meetingCommitments').where('recruiter_id', '==', chatId).get();
    const jobSeekerMeetingsSnapshot = await db.collection('meetingCommitments').where('counterpart_id', '==', chatId.toString()).get(); // Ensure chatId is a string

    console.log(`Number of recruiter meetings fetched: ${recruiterMeetingsSnapshot.size}`);
    console.log(`Number of job seeker meetings fetched: ${jobSeekerMeetingsSnapshot.size}`);

    const upcomingMeetings = [];

    recruiterMeetingsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Recruiter meeting data: ${JSON.stringify(data)}`);
      const meetingTime = moment.tz(data.meeting_scheduled_at, 'UTC').tz(userTimeZone);
      if (meetingTime.isAfter(now)) {
        upcomingMeetings.push({ ...data, meetingTime });
      }
    });

    jobSeekerMeetingsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Job Seeker meeting data: ${JSON.stringify(data)}`);
      const meetingTime = moment.tz(data.meeting_scheduled_at, 'UTC').tz(userTimeZone);
      if (meetingTime.isAfter(now)) {
        upcomingMeetings.push({ ...data, meetingTime });
      }
    });

    upcomingMeetings.sort((a, b) => a.meetingTime - b.meetingTime);

    if (upcomingMeetings.length > 0) {
      let responseMessage = '📂 *Your Scheduled Meetings:*\n'; //Single line break \n
      upcomingMeetings.forEach((meeting, index) => {
        responseMessage += `🗳 *Meeting #${index + 1}*\n`;
        responseMessage += `   *Job Seeker Name:* ${meeting.counterpart_name}\n`;
        responseMessage += `   *Recruiter Name:* ${meeting.recruiter_name}\n`;
        responseMessage += `   *Meeting Scheduled Time:* ${meeting.meetingTime.format('YYYY-MM-DD HH:mm')}\n`;
        responseMessage += `   *Description:* ${meeting.description}\n\n`; //Double line break \n\n - for better visibility
      });
      bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '🤷 No upcoming meetings found.');
    }
  } catch (error) {
    console.error('Error handling /meetingstatus command:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your request | Please try again.');
  }
});

//------------------- Handle /meetinghistory command ------------------//
bot.onText(/\/meetinghistory/, async (msg) => {
  console.log('/meetinghistory command received');
  const chatId = msg.chat.id;

  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      bot.sendMessage(chatId, '🤷 User not found. Please register using /register.');
      return;
    }
    const userTimeZone = userDoc.data().timeZone || 'UTC';
    const now = moment.tz(userTimeZone); // Use moment to get current time in user's time zone
    console.log(`Current time in user's time zone (${userTimeZone}): ${now.format('YYYY-MM-DD HH:mm:ss')}`);

    const recruiterMeetingsSnapshot = await db.collection('meetingCommitments').where('recruiter_id', '==', chatId).get();
    const jobSeekerMeetingsSnapshot = await db.collection('meetingCommitments').where('counterpart_id', '==', chatId.toString()).get(); // Ensure chatId is a string

    console.log(`Number of recruiter meetings fetched: ${recruiterMeetingsSnapshot.size}`);
    console.log(`Number of job seeker meetings fetched: ${jobSeekerMeetingsSnapshot.size}`);

    const pastMeetings = [];

    recruiterMeetingsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Recruiter meeting data: ${JSON.stringify(data)}`);
      const meetingTime = moment.tz(data.meeting_scheduled_at, 'UTC').tz(userTimeZone);
      if (meetingTime.isBefore(now)) {
        pastMeetings.push({ ...data, meetingTime });
      }
    });

    jobSeekerMeetingsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Job Seeker meeting data: ${JSON.stringify(data)}`);
      const meetingTime = moment.tz(data.meeting_scheduled_at, 'UTC').tz(userTimeZone);
      if (meetingTime.isBefore(now)) {
        pastMeetings.push({ ...data, meetingTime });
      }
    });

    pastMeetings.sort((a, b) => a.meetingTime - b.meetingTime);

    if (pastMeetings.length > 0) {
      let responseMessage = '🗄 *Your Meeting History:*\n';
      pastMeetings.forEach((meeting, index) => {
        responseMessage += `🗳 *Meeting #${index + 1}*\n`;
        responseMessage += `   *Job Seeker Name:* ${meeting.counterpart_name}\n`;
        responseMessage += `   *Recruiter Name:* ${meeting.recruiter_name}\n`;
        responseMessage += `   *Meeting Scheduled Time:* ${meeting.meetingTime.format('YYYY-MM-DD HH:mm')}\n`;
        responseMessage += `   *Description:* ${meeting.description}\n\n`;
      });
      bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '🤷 No past meetings found.');
    }
  } catch (error) {
    console.error('Error handling /meetinghistory command:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your request | Please try again.');
  }
});

//------------------- Handle /feedbackstatus command ------------------//
bot.onText(/\/feedbackstatus/, async (msg) => {
  console.log('/feedbackstatus command received');
  const chatId = msg.chat.id;

  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      bot.sendMessage(chatId, '🤷 User not found. Please register using /register.');
      return;
    }
    const userTimeZone = userDoc.data().timeZone || 'UTC';
    const now = moment.tz(userTimeZone); // Use moment to get current time in user's time zone
    console.log(`Current time in user's time zone (${userTimeZone}): ${now.format('YYYY-MM-DD HH:mm:ss')}`);

    const recruiterFeedbacksSnapshot = await db.collection('feedbackCommitments').where('recruiter_id', '==', chatId).get();
    const jobSeekerFeedbacksSnapshot = await db.collection('feedbackCommitments').where('counterpart_id', '==', chatId.toString()).get(); // Ensure chatId is a string

    console.log(`Number of recruiter feedbacks fetched: ${recruiterFeedbacksSnapshot.size}`);
    console.log(`Number of job seeker feedbacks fetched: ${jobSeekerFeedbacksSnapshot.size}`);

    const upcomingFeedbacks = [];

    recruiterFeedbacksSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Recruiter feedback data: ${JSON.stringify(data)}`);
      const feedbackTime = moment.tz(data.feedback_scheduled_at, 'UTC').tz(userTimeZone);
      if (feedbackTime.isAfter(now)) {
        upcomingFeedbacks.push({ ...data, feedbackTime });
      }
    });

    jobSeekerFeedbacksSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Job Seeker feedback data: ${JSON.stringify(data)}`);
      const feedbackTime = moment.tz(data.feedback_scheduled_at, 'UTC').tz(userTimeZone);
      if (feedbackTime.isAfter(now)) {
        upcomingFeedbacks.push({ ...data, feedbackTime });
      }
    });

    upcomingFeedbacks.sort((a, b) => a.feedbackTime - b.feedbackTime);

    if (upcomingFeedbacks.length > 0) {
      let responseMessage = '🗓 *Your Scheduled Feedbacks:*\n';
      upcomingFeedbacks.forEach((feedback, index) => {
        responseMessage += `🗳 *Feedback #${index + 1}*\n`;
        responseMessage += `   *Job Seeker Name:* ${feedback.counterpart_name}\n`;
        responseMessage += `   *Recruiter Name:* ${feedback.recruiter_name}\n`;
        responseMessage += `   *Feedback Scheduled At:* ${feedback.feedbackTime.format('YYYY-MM-DD HH:mm')}\n`;
        responseMessage += `   *Description:* ${feedback.description}\n\n`;
      });
      bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '🤷 No upcoming feedbacks found.');
    }
  } catch (error) {
    console.error('Error handling /feedbackstatus command:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your request | Please try again.');
  }
});

//------------------- Handle /feedbackhistory command ---------------//
bot.onText(/\/feedbackhistory/, async (msg) => {
  console.log('/feedbackhistory command received');
  const chatId = msg.chat.id;

  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      bot.sendMessage(chatId, '🤷 User not found. Please register using /register.');
      return;
    }
    const userTimeZone = userDoc.data().timeZone || 'UTC';
    const now = moment.tz(userTimeZone); // Use moment to get current time in user's time zone
    console.log(`Current time in user's time zone (${userTimeZone}): ${now.format('YYYY-MM-DD HH:mm:ss')}`);

    const recruiterFeedbacksSnapshot = await db.collection('feedbackCommitments').where('recruiter_id', '==', chatId).get();
    const jobSeekerFeedbacksSnapshot = await db.collection('feedbackCommitments').where('counterpart_id', '==', chatId.toString()).get(); // Ensure chatId is a string

    console.log(`Number of recruiter feedbacks fetched: ${recruiterFeedbacksSnapshot.size}`);
    console.log(`Number of job seeker feedbacks fetched: ${jobSeekerFeedbacksSnapshot.size}`);

    const pastFeedbacks = [];

    recruiterFeedbacksSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Recruiter feedback data: ${JSON.stringify(data)}`);
      const feedbackTime = moment.tz(data.feedback_scheduled_at, 'UTC').tz(userTimeZone);
      if (feedbackTime.isBefore(now)) {
        pastFeedbacks.push({ ...data, feedbackTime });
      }
    });

    jobSeekerFeedbacksSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Job Seeker feedback data: ${JSON.stringify(data)}`);
      const feedbackTime = moment.tz(data.feedback_scheduled_at, 'UTC').tz(userTimeZone);
      if (feedbackTime.isBefore(now)) {
        pastFeedbacks.push({ ...data, feedbackTime });
      }
    });

    pastFeedbacks.sort((a, b) => a.feedbackTime - b.feedbackTime);

    if (pastFeedbacks.length > 0) {
      let responseMessage = '🗃 *Your Feedback History:*\n';
      pastFeedbacks.forEach((feedback, index) => {
        responseMessage += `🗳 *Feedback #${index + 1}*\n`;
        responseMessage += `   *Job Seeker Name:* ${feedback.counterpart_name}\n`;
        responseMessage += `   *Recruiter Name:* ${feedback.recruiter_name}\n`;
        responseMessage += `   *Feedback Scheduled At:* ${feedback.feedbackTime.format('YYYY-MM-DD HH:mm')}\n`;
        responseMessage += `   *Description:* ${feedback.description}\n\n`;
      });
      bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '🤷 No past feedbacks found.');
    }
  } catch (error) {
    console.error('Error handling /feedbackhistory command:', error);
    bot.sendMessage(chatId, '🛠 There was an error processing your request | Please try again.');
  }
});

////***************************************////
// Commitment status updates and scoring logic
////**************************************////

// Function to prompt users to update commitment status
async function promptUpdateCommitmentStatus(commitmentId, description, userId, userType) {
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Attended', callback_data: `status_${commitmentId}_attended` },
          { text: '🚫 Missed', callback_data: `status_${commitmentId}_missed` }
        ]
      ]
    }
  };

  bot.sendMessage(userId, `🔔 Please update your attendance status for the ${userType} commitment "${description}":`, opts);
}

// Function to schedule meeting commitment status prompt
function scheduleMeetingCommitmentPrompt(meetingEndTime, commitmentId, description, recruiterId, jobSeekerId) {
  const promptTime = moment(meetingEndTime).add(30, 'minutes').toDate();

  cron.schedule(promptTime, () => {
    console.log(`Prompting users to update status for meeting commitment ${commitmentId}`);
    promptUpdateCommitmentStatus(commitmentId, description, recruiterId, 'meeting');
    promptUpdateCommitmentStatus(commitmentId, description, jobSeekerId, 'meeting');
  });
}

// Function to schedule feedback commitment status prompt
function scheduleFeedbackCommitmentPrompt(feedbackScheduledAt, commitmentId, description, jobSeekerId) {
  const promptTime = moment(feedbackScheduledAt).add(30, 'minutes').toDate();

  cron.schedule(promptTime, () => {
    console.log(`Prompting job seeker to update status for feedback commitment ${commitmentId}`);
    promptUpdateCommitmentStatus(commitmentId, description, jobSeekerId, 'feedback');
  });
}

// Handle button callbacks for commitment status
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const [action, commitmentId, status] = callbackQuery.data.split('_');
  const callbackQueryId = callbackQuery.id;

  // Check if the callback query ID is already in the cache
  if (callbackCache.has(callbackQueryId)) {
    console.log(`Duplicate callback query received: ${callbackQueryId}`);
    return;
  }

  // Store the callback query ID in the cache
  callbackCache.set(callbackQueryId, true);

  if (action === 'status') {
    const chatId = msg.chat.id;

    try {
      console.log(`Updating status for commitment ${commitmentId} to ${status}`);
      const commitmentRef = db.collection('commitments').doc(commitmentId);
      const commitment = await commitmentRef.get();

      if (commitment.exists) {
        await commitmentRef.update({ status });

        const userRef = db.collection('users').doc(chatId.toString());
        const user = await userRef.get();

        if (user.exists) {
          let newScore = user.data().KarmaPoints;
          if (status === 'attended') newScore += 10;
          else if (status === 'missed') newScore -= 10;

          await userRef.update({ KarmaPoints: newScore });

          const userTimeZone = user.data().timeZone || 'UTC';

          bot.sendMessage(chatId, `Your status for ${commitment.data().type} commitment "${commitment.data().description}" has been updated to *${status}*.\n\nYour new Karma Score is *${newScore}*.`, { parse_mode: 'Markdown' });

          const counterpartId = user.data().userType === 'recruiter' ? commitment.data().counterpart_id : commitment.data().recruiter_id;
          const opts = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Attended', callback_data: `status_${commitmentId}_attended` },
                  { text: '🚫 Missed', callback_data: `status_${commitmentId}_missed` }
                ]
              ]
            }
          };

          bot.sendMessage(counterpartId, `🔔 Please update your attendance status for the ${commitment.data().type} commitment "${commitment.data().description}":`, opts);
        }
      } else {
        bot.sendMessage(chatId, '🤷 Commitment not found.');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      bot.sendMessage(chatId, '🛠 There was an error updating the status | Please try again.');
    }
  } else if (action === 'review') {
    const chatId = msg.chat.id;

    try {
      console.log(`Updating review for commitment ${commitmentId} to ${status}`);
      const commitmentRef = db.collection('commitments').doc(commitmentId);
      const commitment = await commitmentRef.get();

      if (commitment.exists) {
        const commitmentData = commitment.data();
        const commitmentType = commitmentData.type;

        let userType, counterpartType;
        if (commitmentType === 'meeting') {
          userType = 'recruiter';
          counterpartType = 'jobSeeker';
        } else if (commitmentType === 'feedback') {
          userType = 'jobSeeker';
          counterpartType = 'recruiter';
        }

        const userRef = db.collection('users').doc(chatId.toString());
        const user = await userRef.get();

        if (user.exists) {
          let newScore = user.data().KarmaPoints;
          if (status === 'fulfilled') {
            newScore += 10;
            await userRef.update({ KarmaPoints: newScore });
            await commitmentRef.update({ [`${userType}_commitment_state`]: 'fulfilled' });
          } else if (status === 'missed') {
            newScore -= 10;
            await userRef.update({ KarmaPoints: newScore });
            await commitmentRef.update({ [`${userType}_commitment_state`]: 'missed' });
          }

          const counterpartId = commitmentData[`${counterpartType}_id`];
          const opts = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Attended', callback_data: `review_${commitmentId}_attended` },
                  { text: '🚫 Missed', callback_data: `review_${commitmentId}_missed` }
                ]
              ]
            }
          };

          bot.sendMessage(counterpartId, `🔔 Update your commitment status for "${commitment.data().description}":`, opts);
          bot.sendMessage(chatId, `❗ Your commitment status for "${commitment.data().description}" has been updated to ${status}.`);

          if (commitmentType === 'feedback') {
            const feedbackOpts = {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Feedback Provided', callback_data: `review_${commitmentId}_feedback_provided` },
                    { text: '🚫 Feedback Not Provided', callback_data: `review_${commitmentId}_feedback_not_provided` }
                  ]
                ]
              }
            };

            bot.sendMessage(counterpartId, `🔔 Did the recruiter provide feedback for the meeting "${commitment.data().description}"?`, feedbackOpts);
          }
        }
      } else {
        bot.sendMessage(chatId, '🤷 Commitment not found.');
      }
    } catch (error) {
      console.error('Error updating review status:', error);
      bot.sendMessage(chatId, '🛠 There was an error updating the review status. Please try again.');
    }
  }
});

// Schedule prompts for existing meeting commitments
async function scheduleExistingMeetingCommitments() {
  try {
    const commitmentsRef = db.collection('commitments').where('type', '==', 'meeting');
    const commitmentsSnapshot = await commitmentsRef.get();

    commitmentsSnapshot.forEach(doc => {
      const data = doc.data();
      scheduleMeetingCommitmentPrompt(data.meeting_end_time, doc.id, data.description, data.recruiter_id, data.counterpart_id);
    });
  } catch (error) {
    console.error('Error scheduling existing meeting commitments:', error);
  }
}

// Schedule prompts for existing feedback commitments
async function scheduleExistingFeedbackCommitments() {
  try {
    const commitmentsRef = db.collection('commitments').where('type', '==', 'feedback');
    const commitmentsSnapshot = await commitmentsRef.get();

    commitmentsSnapshot.forEach(doc => {
      const data = doc.data();
      scheduleFeedbackCommitmentPrompt(data.feedback_scheduled_at, doc.id, data.description, data.counterpart_id);
    });
  } catch (error) {
    console.error('Error scheduling existing feedback commitments:', error);
  }
}

// Call the functions to schedule prompts for existing commitments when the bot starts
scheduleExistingMeetingCommitments();
scheduleExistingFeedbackCommitments();

////*******************////
//// Subscription logic ////
////******************////

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log(`Webhook event received: ${event.type}`);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Check if the event is from test mode
  if (!event.livemode) {
    console.log('Received a test event.');
  } else {
    console.log('Received a live event.');
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object);
      break;
    case 'customer.subscription.created':
      await handleSubscriptionCreated(event.data.object);
      break;
    case 'customer.subscription.updated':
      if (event.data.object.cancel_at_period_end) {
        await handleSubscriptionCancellation(event.data.object);
      } else {
        await handleSubscriptionUpdate(event.data.object);
      }
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeletion(event.data.object);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
});

// Handle checkout session completed
const handleCheckoutSessionCompleted = async (session) => {
  const customerId = session.customer;
  const subscriptionId = session.subscription; // Ensure this is set in session metadata
  const newPriceId = session.metadata.new_price_id;

  console.log(`Handling checkout.session.completed for session: ${JSON.stringify(session)}`);

  const userRef = db.collection('users').where('stripeCustomerId', '==', customerId);
  const snapshot = await userRef.get();

  if (!snapshot.empty) {
    snapshot.forEach(async (doc) => {
      console.log(`Checkout session completed for user ${doc.id}`);

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      // Update the subscription to the new plan with proration
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
        items: [{
          id: subscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: 'create_prorations', // Apply proration
      });

      console.log(`Updated subscription: ${JSON.stringify(updatedSubscription)}`);

      const userTimeZone = doc.data().timeZone || 'UTC';
      await doc.ref.update({
        'subscription.status': updatedSubscription.status,
        'subscription.expiry': moment(updatedSubscription.current_period_end * 1000).tz(userTimeZone).toISOString(),
        stripeSubscriptionId: updatedSubscription.id
      });

      bot.sendMessage(doc.id, '🎉 Your subscription was successfully updated! Thank you for subscribing.');
    });
  } else {
    console.log(`No user found with stripeCustomerId: ${customerId}`);
  }
};

// Function to handle subscription creation
const handleSubscriptionCreated = async (subscription) => {
  const customerId = subscription.customer;
  const userRef = db.collection('users').where('stripeCustomerId', '==', customerId);
  const snapshot = await userRef.get();

  if (!snapshot.empty) {
    snapshot.forEach(async (doc) => {
      console.log(`Subscription created for user ${doc.id}`);
      const userTimeZone = doc.data().timeZone || 'UTC'; // Retrieve user's time zone
      await doc.ref.update({
        'subscription.status': subscription.status,
        'subscription.expiry': moment(subscription.current_period_end * 1000).tz(userTimeZone).toISOString(),
        stripeSubscriptionId: subscription.id
      });
    });
  } else {
    console.log(`No user found with stripeCustomerId: ${customerId}`);
  }
};

// Function to handle subscription updates
const handleSubscriptionUpdate = async (subscription) => {
  const customerId = subscription.customer;
  const userRef = db.collection('users').where('stripeCustomerId', '==', customerId);
  const snapshot = await userRef.get();

  if (!snapshot.empty) {
    snapshot.forEach(async (doc) => {
      const userTimeZone = doc.data().timeZone || 'UTC'; // Retrieve user's time zone
      let status = subscription.status;
      if (status === 'canceled' && subscription.cancel_at_period_end) {
        status = 'canceled'; // Mark as canceled but user still has access until end of period
      }
      console.log(`Updating subscription for user ${doc.id} to status ${status}`);
      console.log(`Subscription ID: ${subscription.id}`);
      await doc.ref.update({
        'subscription.status': status,
        'subscription.expiry': moment(subscription.current_period_end * 1000).tz(userTimeZone).toISOString(),
        stripeSubscriptionId: subscription.id
      });
    });
  } else {
    console.log(`No user found with stripeCustomerId: ${customerId}`);
  }
};

// Function to handle subscription cancellations
const handleSubscriptionCancellation = async (subscription) => {
  const customerId = subscription.customer;
  const userRef = db.collection('users').where('stripeCustomerId', '==', customerId);
  const snapshot = await userRef.get();

  if (!snapshot.empty) {
    snapshot.forEach(async (doc) => {
      console.log(`Cancelling subscription for user ${doc.id}`);
      await doc.ref.update({
        'subscription.status': 'canceled',
        'subscription.expiry': moment(subscription.current_period_end * 1000).toISOString(), // Maintain expiry date
        stripeSubscriptionId: subscription.id // Keep the subscription ID until it's fully expired
      });
    });
  } else {
    console.log(`No user found with stripeCustomerId: ${customerId}`);
  }
};

// Function to handle subscription deletions
const handleSubscriptionDeletion = async (subscription) => {
  const customerId = subscription.customer;
  const userRef = db.collection('users').where('stripeCustomerId', '==', customerId);
  const snapshot = await userRef.get();

  if (!snapshot.empty) {
    snapshot.forEach(async (doc) => {
      console.log(`Subscription expired for user ${doc.id}`);
      await doc.ref.update({
        'subscription.status': 'expired',
        'subscription.expiry': null,
        stripeSubscriptionId: null
      });
    });
  } else {
    console.log(`No user found with stripeCustomerId: ${customerId}`);
  }
};

// Creating a Stripe checkout session for recruiters
const createCheckoutSession = async (priceId, chatId, subscriptionType) => {
  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const user = userDoc.data();
    let customerId = user.stripeCustomerId;

    // Create a Stripe customer if one doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: user.name,
        metadata: {
          chatId: chatId.toString(),
          telegramUserName: user.name
        }
      });
      customerId = customer.id;
      await userRef.update({
        stripeCustomerId: customerId
      });
    }

    // Check existing subscriptions
    const subscriptions = await stripe.subscriptions.list({ customer: customerId });
    let existingSubscription = subscriptions.data.find(sub => sub.status === 'active' || (sub.status === 'canceled' && !sub.ended_at));

    if (existingSubscription) {
      if ((subscriptionType === 'monthly' && existingSubscription.items.data[0].price.id === 'price_1PWKHCP9AlrL3WaNZJ2wentT') ||
          (subscriptionType === 'yearly' && existingSubscription.items.data[0].price.id === 'price_1PWKHrP9AlrL3WaNM00tMFk1')) {
        // If the subscription is of the same type, deny creating a new one
        const errorMessage = 'You already have an active subscription of this type.';
        console.error(errorMessage);
        throw new Error(errorMessage);
      } else {
        // Update the existing subscription with the new price and proration
        const updatedSubscription = await stripe.subscriptions.update(existingSubscription.id, {
          items: [{
            id: existingSubscription.items.data[0].id,
            price: priceId,
          }],
          proration_behavior: 'create_prorations', // Apply proration
        });

        return null; // No URL, as the subscription is updated
      }
    } else {
      // Create a new subscription
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        mode: 'subscription',
        customer: customerId, // Link the session to the Stripe customer
        client_reference_id: chatId.toString(), // Add this line to ensure client_reference_id is set
        success_url: `${process.env.BOT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BOT_URL}/cancel?session_id={CHECKOUT_SESSION_ID}`
      });

      return session.url;
    }
  } catch (error) {
    console.error('Error creating or updating subscription:', error.message);
    throw new Error(error.message || 'Internal Server Error');
  }
};

// Endpoint to retrieve the subscription status for a user
app.get('/subscription-status', async (req, res) => {
  const { chatId } = req.query;

  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const subscription = userDoc.data().subscription;
      res.json(subscription);
    } else {
      res.status(404).send('User not found');
    }
  } catch (error) {
    console.error('Error retrieving subscription status:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Success route
app.get('/success', async (req, res) => {
  console.log('Accessed /success route');
  const sessionId = req.query.session_id;
  console.log(`Received session ID: ${sessionId}`);

  if (!sessionId) {
    res.status(400).send('Session ID is required');
    return;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(`Stripe session retrieved: ${JSON.stringify(session)}`);

    if (session) {
      const chatId = session.client_reference_id; // Ensure this is set when creating the session

      // Send a chat bot message to notify the user
      if (chatId) {
        bot.sendMessage(chatId, '🎉 Your subscription was successful! Thank you for subscribing.');
      }

      res.send('Thank you for your subscription! Your payment was successful.');
    } else {
      res.status(404).send('Session not found');
    }
  } catch (error) {
    console.error('Error retrieving checkout session:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Cancel route
app.get('/cancel', (req, res) => {
  console.log('Accessed /cancel route');
  const sessionId = req.query.session_id;
  console.log(`Received session ID: ${sessionId}`);

  // Optionally, log the cancellation or perform other actions
  if (sessionId) {
    console.log(`Subscription process was canceled for session ID: ${sessionId}`);
    // Perform additional logic if necessary
  }

  res.send('Your subscription process was canceled. Please try again.');
});

// Handle /subscribe command
bot.onText(/\/subscribe/, async (msg) => {
  console.log('/subscribe command received');
  const chatId = msg.chat.id;
  const user = await getUser(chatId);

  if (user) {
    if (user.userType !== 'recruiter') {
      bot.sendMessage(chatId, '❗ Only recruiters need to subscribe.\n\nPlease update your role using /setrecruiter if you are a recruiter.');
      return;
    }

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👑 Subscribe Yearly (99 EUR)', callback_data: 'subscribe_yearly' },
            { text: '💎 Subscribe Monthly (15 EUR)', callback_data: 'subscribe_monthly' }
          ],
          [
            { text: '🚫 Unsubscribe', callback_data: 'unsubscribe' }
          ]
        ]
      }
    };
    bot.sendMessage(chatId, '🧾 Please choose your subscription plan:', opts);
  }
});

// Handle button presses for subscription options
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const user = await getUser(chatId);
  const callbackQueryId = callbackQuery.id;

  // Check if the callback query ID is already in the cache
  if (callbackCache.has(callbackQueryId)) {
    console.log(`Duplicate callback query received: ${callbackQueryId}`);
    return;
  }

  // Store the callback query ID in the cache
  callbackCache.set(callbackQueryId, true);

  let priceId;
  let subscriptionType;
  if (callbackQuery.data === 'subscribe_yearly') {
    priceId = 'price_1PWKHrP9AlrL3WaNM00tMFk1';
    subscriptionType = 'yearly';
  } else if (callbackQuery.data === 'subscribe_monthly') {
    priceId = 'price_1PWKHCP9AlrL3WaNZJ2wentT';
    subscriptionType = 'monthly';
  } else if (callbackQuery.data === 'unsubscribe') {
    const stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      bot.sendMessage(chatId, '🤷 You do not have an active subscription to unsubscribe from.');
      return;
    }

    try {
      const subscriptions = await stripe.subscriptions.list({ customer: stripeCustomerId });
      if (subscriptions.data.length === 0) {
        bot.sendMessage(chatId, '🤷 You do not have an active subscription to unsubscribe from.');
        return;
      }

      await handleUnsubscribe(stripeCustomerId);
      await db.collection('users').doc(chatId.toString()).update({
        'subscription.status': 'canceled',
        'subscription.expiry': moment(subscriptions.data[0].current_period_end * 1000).toISOString(),
        stripeSubscriptionId: subscriptions.data[0].id
      });
      bot.sendMessage(chatId, `😿 Your subscription has been marked to cancel on ${moment(subscriptions.data[0].current_period_end * 1000).format('DD MMM YYYY')}.`);
    } catch (error) {
      console.error('Error during unsubscription:', error);
      bot.sendMessage(chatId, '🛠 There was an error processing your unsubscription. Please try again.');
    }
    return;
  }

  if (priceId) {
    try {
      const sessionUrl = await createCheckoutSession(priceId, chatId, subscriptionType);
      if (!sessionUrl) {
        bot.sendMessage(chatId, '🎉 Your subscription has been updated successfully.');
      } else {
        bot.sendMessage(chatId, `💳 Please complete your subscription payment using this link: ${sessionUrl}`);
      }
    } catch (error) {
      console.error('Error creating or updating Stripe subscription:', error.message);
      bot.sendMessage(chatId, `🛠 There was an error processing your subscription. ${error.message}`);
    }
  }
});

// Function to handle unsubscribe
const handleUnsubscribe = async (customerId) => {
  try {
    const subscriptions = await stripe.subscriptions.list({ customer: customerId });
    if (subscriptions.data.length > 0) {
      for (const subscription of subscriptions.data) {
        await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
      }
      console.log(`All subscriptions for customer ${customerId} have been marked to cancel at period end.`);
    } else {
      console.log('No active subscriptions found for customer:', customerId);
    }
  } catch (error) {
    console.error('Error retrieving subscriptions for customer:', customerId, error);
    throw new Error('Error during unsubscription process.');
  }
};

// Middleware to check subscription status
const checkSubscriptionStatus = async (chatId, command) => {
  const userRef = db.collection('users').doc(chatId.toString());
  const userDoc = await userRef.get();

  if (userDoc.exists) {
    const user = userDoc.data();

    if (user.userType === 'recruiter') {
      const now = moment().tz(user.timeZone || 'UTC');
      const expiryDate = moment(user.subscription.expiry).tz(user.timeZone || 'UTC');

      if (user.subscription.status === 'trial' && now.isSameOrAfter(expiryDate)) {
        await userRef.update({
          'subscription.status': 'expired'
        });
        bot.sendMessage(chatId, '❗❗ Your trial period has expired.\n\n💳 Please subscribe to continue using the service.');
        return false;
      } else if (user.subscription.status === 'expired') {
        if (notAllowedCommands.includes(command)) {
          bot.sendMessage(chatId, '❗❗ Your subscription has expired.\n\n💳 Please subscribe to continue using the service.');
          return false;
        }
      }
    }
  }
  return true;
};

// Schedule the function to check subscription status every day
schedule.scheduleJob('0 0 * * *', async () => {
  console.log('Checking trial periods...');
  const usersRef = db.collection('users');
  const usersSnapshot = await usersRef.where('userType', '==', 'recruiter').get();

  usersSnapshot.forEach(async (userDoc) => {
    const user = userDoc.data();
    const expiryDate = moment(user.subscription.expiry).tz(user.timeZone || 'UTC');
    const now = moment().tz(user.timeZone || 'UTC');

    if (user.subscription.status === 'trial' && now.isSameOrAfter(expiryDate)) {
      await usersRef.doc(userDoc.id).update({
        'subscription.status': 'expired'
      });
      bot.sendMessage(userDoc.id, '❗❗ Your trial period has expired.\n\n💳 Please subscribe to continue using the service.');
    }
  });
});

/////******************////
//  Send reminders logic
////******************////

// Function to send meeting reminders
const sendMeetingReminders = async () => {
  console.log('Sending meeting reminders...');
  const now = new Date();
  const meetings = await db.collection('meetingCommitments').get();

  meetings.forEach(async (doc) => {
    const meeting = doc.data();
    const meetingDate = moment.tz(meeting.meeting_scheduled_at, 'UTC'); // Assume stored in UTC

    // Skip past meetings
    if (meetingDate.isBefore(now)) {
      return;
    }

    // Adjust meeting date to the user's time zone
    const recruiterRef = await db.collection('users').doc(meeting.recruiter_id.toString()).get();
    const counterpartRef = await db.collection('users').doc(meeting.counterpart_id.toString()).get();

    const recruiterTimeZone = recruiterRef.exists ? recruiterRef.data().timeZone : 'UTC';
    const counterpartTimeZone = counterpartRef.exists ? counterpartRef.data().timeZone : 'UTC';

    const recruiterMeetingTime = meetingDate.clone().tz(recruiterTimeZone);
    const counterpartMeetingTime = meetingDate.clone().tz(counterpartTimeZone);

    const recruiterReminder24h = recruiterMeetingTime.clone().subtract(24, 'hours');
    const recruiterReminder1h = recruiterMeetingTime.clone().subtract(1, 'hour');
    const counterpartReminder24h = counterpartMeetingTime.clone().subtract(24, 'hours');
    const counterpartReminder1h = counterpartMeetingTime.clone().subtract(1, 'hour');

    // Reminder 24 hours before
    if (moment().isBetween(recruiterReminder24h, recruiterReminder24h.clone().add(1, 'minutes'))) {
      bot.sendMessage(meeting.recruiter_id, `🚨 *Reminder:* You have a *meeting* "${meeting.description}" with *${meeting.counterpart_name}* scheduled on *${recruiterMeetingTime.format('YYYY-MM-DD HH:mm')}*.`, { parse_mode: 'Markdown' });
    }
    if (moment().isBetween(counterpartReminder24h, counterpartReminder24h.clone().add(1, 'minutes'))) {
      bot.sendMessage(meeting.counterpart_id, `🚨 *Reminder:* You have a *meeting* "${meeting.description}" with *${meeting.recruiter_name}* scheduled on *${counterpartMeetingTime.format('YYYY-MM-DD HH:mm')}*.`, { parse_mode: 'Markdown' });
    }

    // Reminder 1 hour before
    if (moment().isBetween(recruiterReminder1h, recruiterReminder1h.clone().add(1, 'minutes'))) {
      bot.sendMessage(meeting.recruiter_id, `🚨 *Reminder:* Your *meeting* "${meeting.description}" with *${meeting.counterpart_name}* is happening in *1 hour*.`, { parse_mode: 'Markdown' });
    }
    if (moment().isBetween(counterpartReminder1h, counterpartReminder1h.clone().add(1, 'minutes'))) {
      bot.sendMessage(meeting.counterpart_id, `🚨 *Reminder:* Your *meeting* "${meeting.description}" with *${meeting.recruiter_name}* is happening in *1 hour*.`, { parse_mode: 'Markdown' });
    }
  });
};

const sendFeedbackReminders = async () => {
  console.log('Sending feedback reminders...');
  const now = new Date();
  const feedbacks = await db.collection('feedbackRequests').get();

  feedbacks.forEach(async (doc) => {
    const feedback = doc.data();
    const feedbackDate = moment.tz(feedback.feedback_scheduled_at, 'UTC'); // Assume stored in UTC

    // Skip past feedbacks
    if (feedbackDate.isBefore(now)) {
      return;
    }

    // Adjust feedback date to the user's time zone
    const recruiterRef = await db.collection('users').doc(feedback.recruiter_id.toString()).get();
    const counterpartRef = await db.collection('users').doc(feedback.counterpart_id.toString()).get();

    const recruiterTimeZone = recruiterRef.exists ? recruiterRef.data().timeZone : 'UTC';
    const counterpartTimeZone = counterpartRef.exists ? counterpartRef.data().timeZone : 'UTC';

    const recruiterFeedbackTime = feedbackDate.clone().tz(recruiterTimeZone);
    const counterpartFeedbackTime = feedbackDate.clone().tz(counterpartTimeZone);

    const recruiterReminder24h = recruiterFeedbackTime.clone().subtract(24, 'hours');
    const recruiterReminder1h = recruiterFeedbackTime.clone().subtract(1, 'hour');
    const counterpartReminder24h = counterpartFeedbackTime.clone().subtract(24, 'hours');
    const counterpartReminder1h = counterpartFeedbackTime.clone().subtract(1, 'hour');

    // Reminder 24 hours before
    if (moment().isBetween(recruiterReminder24h, recruiterReminder24h.clone().add(1, 'minutes'))) {
      bot.sendMessage(feedback.recruiter_id, `🚨 *Reminder:* You have a *feedback* request for your meeting with *${feedback.counterpart_name}* scheduled on *${recruiterFeedbackTime.format('YYYY-MM-DD HH:mm')}*.`, { parse_mode: 'Markdown' });
    }
    if (moment().isBetween(counterpartReminder24h, counterpartReminder24h.clone().add(1, 'minutes'))) {
      bot.sendMessage(feedback.counterpart_id, `🚨 *Reminder:* You have a *feedback* request for your meeting with *${feedback.recruiter_name}* scheduled on *${counterpartFeedbackTime.format('YYYY-MM-DD HH:mm')}*.`, { parse_mode: 'Markdown' });
    }

    // Reminder 1 hour before
    if (moment().isBetween(recruiterReminder1h, recruiterReminder1h.clone().add(1, 'minutes'))) {
      bot.sendMessage(feedback.recruiter_id, `🚨 *Reminder:* Your *feedback* request for your meeting with *${feedback.counterpart_name}* is due in *1 hour*.`, { parse_mode: 'Markdown' });
    }
    if (moment().isBetween(counterpartReminder1h, counterpartReminder1h.clone().add(1, 'minutes'))) {
      bot.sendMessage(feedback.counterpart_id, `🚨 *Reminder:* Your *feedback* request for your meeting with *${feedback.recruiter_name}* is due in *1 hour*.`, { parse_mode: 'Markdown' });
    }
  });
};

// Schedule the reminder functions to run every minute
schedule.scheduleJob('* * * * *', sendMeetingReminders);
schedule.scheduleJob('* * * * *', sendFeedbackReminders);

app.get('/', (req, res) => {
  res.send('Yay! KarmaComet bot is up and running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
