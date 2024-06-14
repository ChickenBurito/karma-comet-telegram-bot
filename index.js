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

// Log every message received
bot.on('message', (msg) => {
  console.log(`Message received: ${msg.text}`);
});

// Handle /start command
bot.onText(/\/start/, (msg) => {
  console.log('/start command received');
  const chatId = msg.chat.id;
  const userName = msg.from.username || 'there';

  const greeting = `Hi ${userName}!`;
  const description = `
 I am KarmaComet Bot!

 The first-ever solution to revolutionise the recruitment process for both job seekers and recruiters. I ensure that all parties stay true to their commitments, helping everyone save time and money.
  
  🌟 Key Features:
  - **Accountability**: Ensures both job seekers and recruiters keep their promises.
  - **Commitment Tracking**: Log and track all your commitments with precise dates, times, and descriptions.
  - **Automated Reminders**: Never forget a meeting or interview with our timely reminders.
  - **Feedback Enforcement**: Pushes recruiters and Job seekers to share timely feedback, improving transparency and trust.
  - **Score System**: Track your reliability with a scoring system based on your commitment fulfillment.
  - **Subscription Services**: Recruiters can subscribe for advanced features and management tools.
  
  📋 User Guide:
  - **/register**: Register yourself as a job seeker using your Telegram username.
  - **/setrecruiter**: Switch your role to a recruiter.
  - **/setjobseeker**: Switch your role back to a job seeker.
  - **/meeting <YYYY-MM-DD HH:MM> <counterpart_username> <description>**: Schedule a meeting.
  - **/feedback <YYYY-MM-DD HH:MM> <counterpart_username> <description>**: Provide feedback.
  - **/status**: Update the status of your commitments using easy-to-select buttons.
  - **/subscribe**: Subscribe to premium recruiter services.
  
  KarmaComet Bot is here to streamline the recruitment process, ensuring every meeting, interview, and feedback session happens on time and as planned. Let's make recruitment more efficient and reliable!`;

  bot.sendMessage(chatId, greeting);
  bot.sendMessage(chatId, description);
  bot.sendMessage(chatId, "Type /register <your_name> to get started.");
});

/// Handle /register command with telegram username
bot.onText(/\/register/, async (msg) => {
  console.log('/register command received');
  const chatId = msg.chat.id;
  const userName = msg.from.username || 'User';

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

    bot.sendMessage(chatId, `Hello, ${userName}! Your registration is complete. You can change your role to recruiter if needed using /setrecruiter. You are all set! You can now schedule a meeting or wait for incoming requests.`);
  } catch (error) {
    console.error('Error registering user:', error);
    bot.sendMessage(chatId, 'There was an error processing your registration. Please try again.');
  }
});

// Handle /setrecruiter command
bot.onText(/\/setrecruiter/, async (msg) => {
  console.log('/setrecruiter command received');
  const chatId = msg.chat.id;

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Individual', callback_data: 'recruiter_individual' },
          { text: 'Company', callback_data: 'recruiter_company' }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, 'Are you an individual recruiter or registering as a company?', opts);
});

// Handle callback query for recruiter type
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  if (data === 'recruiter_individual') {
    try {
      await db.collection('users').doc(chatId.toString()).update({
        userType: 'recruiter',
        recruiterType: 'individual'
      });
      bot.sendMessage(chatId, 'You are now registered as an individual recruiter. Please type /subscribe to subscribe for recruiter services.');
    } catch (error) {
      console.error('Error setting recruiter role:', error);
      bot.sendMessage(chatId, 'There was an error updating your role. Please try again.');
    }
  } else if (data === 'recruiter_company') {
    bot.sendMessage(chatId, 'Please enter your company name using the format: /company <company_name>');
  }
});

// Handle company name input
bot.onText(/\/company (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const companyName = match[1];

  try {
    await db.collection('users').doc(chatId.toString()).update({
      userType: 'recruiter',
      recruiterType: 'company',
      companyName: companyName
    });
    bot.sendMessage(chatId, `You are now registered as a company recruiter for ${companyName}. Please type /subscribe to subscribe for recruiter services.`);
  } catch (error) {
    console.error('Error setting company recruiter role:', error);
    bot.sendMessage(chatId, 'There was an error updating your role. Please try again.');
  }
});

// Handle /setjobseeker command
bot.onText(/\/setjobseeker/, async (msg) => {
  console.log('/setjobseeker command received');
  const chatId = msg.chat.id;

  try {
    const userRef = db.collection('users').doc(chatId.toString());
    const user = await userRef.get();

    if (user.exists) {
      if (user.data().userType === 'jobSeeker') {
        bot.sendMessage(chatId, "You are already a job seeker.");
      } else {
        await userRef.update({
          userType: 'jobSeeker'
        });

        bot.sendMessage(chatId, "Your role has been updated to job seeker. Your subscription status remains unchanged.");
      }
    } else {
      bot.sendMessage(chatId, "User not found. Please register first using /register <your_name>.");
    }
  } catch (error) {
    console.error('Error setting job seeker role:', error);
    bot.sendMessage(chatId, 'There was an error updating your role. Please try again.');
  }
});

////******************////
// Log commitments
////******************////

// Log commitments for meetings
bot.onText(/\/meeting (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) @(\w+) (.+)/, async (msg, match) => {
  console.log('/meeting command received');
  const chatId = msg.chat.id;
  const [dateTime, counterpartUsername, description] = match.slice(1);

  try {
    const counterpartRef = await db.collection('users').where('name', '==', counterpartUsername).get();

    if (!counterpartRef.empty) {
      const counterpart = counterpartRef.docs[0];
      const counterpartId = counterpart.id;

      console.log(`Requesting counterpart ${counterpartId} to accept meeting: ${description} on ${dateTime}`);

      const [date, time] = dateTime.split(' ');

      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Accept', callback_data: `accept_meeting_${chatId}_${counterpartUsername}_${dateTime}_${description}` },
              { text: 'Decline', callback_data: `decline_meeting_${chatId}_${counterpartUsername}_${description}` }
            ]
          ]
        }
      };

      bot.sendMessage(counterpartId, `You have a meeting request from @${msg.from.username}: ${description} on ${date} at ${time}. Do you accept?`, opts);
    } else {
      bot.sendMessage(chatId, `User @${counterpartUsername} not found.`);
    }
  } catch (error) {
    console.error('Error requesting meeting:', error);
    bot.sendMessage(chatId, 'There was an error sending the meeting request. Please try again.');
  }
});

// Log commitments for feedback
bot.onText(/\/feedback (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) @(\w+) (.+)/, async (msg, match) => {
  console.log('/feedback command received');
  const chatId = msg.chat.id;
  const [dateTime, counterpartUsername, description] = match.slice(1);

  try {
    const counterpartRef = await db.collection('users').where('name', '==', counterpartUsername).get();

    if (!counterpartRef.empty) {
      const counterpart = counterpartRef.docs[0];
      const counterpartId = counterpart.id;

      console.log(`Requesting counterpart ${counterpartId} to accept feedback: ${description} on ${dateTime}`);

      const [date, time] = dateTime.split(' ');

      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Accept', callback_data: `accept_feedback_${chatId}_${counterpartUsername}_${dateTime}_${description}` },
              { text: 'Decline', callback_data: `decline_feedback_${chatId}_${counterpartUsername}_${description}` }
            ]
          ]
        }
      };

      bot.sendMessage(counterpartId, `You have a feedback request from @${msg.from.username}: ${description} on ${date} at ${time}. Do you accept?`, opts);
    } else {
      bot.sendMessage(chatId, `User @${counterpartUsername} not found.`);
    }
  } catch (error) {
    console.error('Error requesting feedback:', error);
    bot.sendMessage(chatId, 'There was an error sending the feedback request. Please try again.');
  }
});

// Handle feedback days command
bot.onText(/\/feedbackdays (\d+)_([\w-]+)/, async (msg, match) => {
  console.log('/feedbackdays command received');
  const chatId = msg.chat.id;
  const [days, commitmentId] = match.slice(1);

  try {
    const commitmentRef = db.collection('commitments').doc(commitmentId);
    const commitment = await commitmentRef.get();

    if (commitment.exists) {
      const counterpartId = commitment.data().counterpartId;
      const feedbackDueDate = new Date();
      feedbackDueDate.setDate(feedbackDueDate.getDate() + parseInt(days));

      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Approve', callback_data: `approve_feedback_${commitmentId}_${feedbackDueDate.toISOString()}` },
              { text: 'Decline', callback_data: `decline_feedback_${commitmentId}` }
            ]
          ]
        }
      };

      bot.sendMessage(counterpartId, `You have a feedback request from @${msg.from.username} for the meeting "${commitment.data().description}". Feedback will be provided within ${days} days. Do you approve?`, opts);
    } else {
      bot.sendMessage(chatId, 'Commitment not found.');
    }
  } catch (error) {
    console.error('Error handling feedback days:', error);
    bot.sendMessage(chatId, 'There was an error processing your request. Please try again.');
  }
});

// Handle button callbacks for commitment acceptance or decline
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data.split('_');

  const action = data[0];
  const type = data[1];
  const counterpartId = data[2];
  const counterpartUsername = data[3];
  const dateTime = data[4];
  const description = data.slice(5).join('_');

  if (action === 'accept' || action === 'decline') {
    try {
      const [date, time] = dateTime.split(' ');

      if (action === 'accept') {
        console.log(`Creating commitment: ${description} on ${date} at ${time} between ${chatId} and ${counterpartId}`);

        await db.collection('commitments').add({
          userId: counterpartId,
          counterpartId: chatId,
          date,
          time,
          description,
          type: type,
          status: 'pending'
        });

        bot.sendMessage(chatId, `Your request for ${type} on ${date} at ${time} has been accepted by @${counterpartUsername}.`);
        bot.sendMessage(counterpartId, `You have accepted the ${type} request from @${msg.from.username} for ${description} on ${date} at ${time}.`);
      } else if (action === 'decline') {
        console.log(`Declining commitment: ${description} on ${date} at ${time} by ${chatId}`);

        bot.sendMessage(counterpartId, `Your request for ${type} on ${date} at ${time} was declined by @${msg.from.username}.`);
        bot.sendMessage(chatId, `Your request for ${type} on ${date} at ${time} was declined by @${counterpartUsername}.`);
      }
    } catch (error) {
      console.error('Error handling callback query:', error);
      bot.sendMessage(chatId, 'There was an error processing your response. Please try again.');
    }
  }

  if (type === 'feedback') {
    try {
      const commitmentRef = db.collection('commitments').doc(commitmentId);
      const commitment = await commitmentRef.get();

      if (commitment.exists) {
        const feedbackDueDate = new Date(data[3]);

        if (action === 'approve') {
          console.log(`Creating feedback commitment: ${commitment.data().description} due on ${feedbackDueDate}`);

          await db.collection('commitments').add({
            userId: commitment.data().userId,
            counterpartId: commitment.data().counterpartId,
            date: feedbackDueDate.toISOString().split('T')[0],
            time: feedbackDueDate.toISOString().split('T')[1].slice(0, 5),
            description: `Feedback for meeting: ${commitment.data().description}`,
            type: 'feedback',
            status: 'pending'
          });

          bot.sendMessage(commitment.data().userId, `Your feedback request for the meeting "${commitment.data().description}" has been approved by @${msg.from.username}. Feedback is due by ${feedbackDueDate.toDateString()}.`);
          bot.sendMessage(commitment.data().counterpartId, `You have approved the feedback request for the meeting "${commitment.data().description}". Feedback is due by ${feedbackDueDate.toDateString()}.`);
        } else if (action === 'decline') {
          console.log(`Declining feedback commitment: ${commitment.data().description}`);

          bot.sendMessage(commitment.data().userId, `Your feedback request for the meeting "${commitment.data().description}" was declined by @${msg.from.username}.`);
          bot.sendMessage(commitment.data().counterpartId, `You have declined the feedback request for the meeting "${commitment.data().description}".`);
        }
      } else {
        bot.sendMessage(chatId, 'Commitment not found.');
      }
    } catch (error) {
      console.error('Error handling callback query:', error);
      bot.sendMessage(chatId, 'There was an error processing your response. Please try again.');
    }
  }
});

////******************////
// Commitment status updates and scoring logic
////******************////

bot.onText(/\/status (\w+)/, async (msg, match) => {
  console.log('/status command received');
  const chatId = msg.chat.id;
  const commitmentId = match[1];

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Attended', callback_data: `status_${commitmentId}_attended` },
          { text: 'Missed', callback_data: `status_${commitmentId}_missed` }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, 'Update your commitment status:', opts);
});

// Handle button callbacks for commitment status
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const [action, commitmentId, status] = callbackQuery.data.split('_');

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

            // Automatically create feedback request after 2 hours
            setTimeout(async () => {
              bot.sendMessage(chatId, `Please specify the number of days you will take to provide feedback for the meeting "${commitment.data().description}" using the format: /feedbackdays <number_of_days>_${commitmentId}`);
            }, 2 * 60 * 60 * 1000); // 2 hours in milliseconds
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
  }
});

////******************////
// Subscription logic
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
  const commitments = await db.collection('commitments').where('status', 'pending').get();

  commitments.forEach(async (doc) => {
    const commitment = doc.data();
    const commitmentDate = new Date(`${commitment.date} ${commitment.time}`);

    if (commitmentDate > now && (commitmentDate - now) <= 24 * 60 * 60 * 1000) { // Reminder 24 hours before
      bot.sendMessage(commitment.userId, `Reminder: You have a commitment "${commitment.description}" on ${commitment.date} at ${commitment.time}.`);
      bot.sendMessage(commitment.counterpartId, `Reminder: You have a commitment "${commitment.description}" on ${commitment.date} at ${commitment.time}.`);
    }
  });
};

schedule.scheduleJob('0 * * * *', sendReminders); // Run every hour

    // Express app setup
const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Yay! KarmaComet is up and running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
