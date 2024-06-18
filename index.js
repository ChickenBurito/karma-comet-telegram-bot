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

// Define the commands
const commands = [
  { command: '/start', description: 'Start the KarmaComet bot' },
  { command: '/register', description: 'Register as a user' },
  { command: '/meeting', description: 'To schedule a meeting add @username and description' },
  { command: '/userinfo', description: 'See user profile' },
  { command: '/meetingstatus', description: 'Get scheduled meetings' },
  { command: '/meetinghistory', description: 'Get past meetings' },
  { command: '/feedbackstatus', description: 'Get scheduled feedbacks' },
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
  🟢 Accountability: Ensures both job seekers and recruiters keep their promises.
  🟢 Commitment Tracking: Log and track all your meetings and feedbacks with precise dates, times, and descriptions.
  🟢 Automated Reminders: Never forget a meeting or interview with our timely reminders.
  🟢 Feedback Enforcement: Pushes recruiters and Job seekers to share timely feedback, improving transparency and trust.
  🟢 Score System: Track your reliability with a scoring system based on your commitment fulfillment.
  🟢 Subscription Services: Recruiters can subscribe for advanced features and management tools.
  
  📋 User Guide:
  - **/register**: Register yourself as a job seeker using your Telegram username.
  - **/setrecruiter**: Switch your role to a recruiter.
  - **/setjobseeker**: Switch your role back to a job seeker.
  - **/meeting @username description**: Schedule a meeting.
  - **/userinfo**: Check your user profile.
  - **/meetingstatus**: See full list of scheduled meetings.
  - **/feedbackstatus**: See full list of pending feedbacks.
  - **/subscribe**: Subscribe to premium recruiter services.
  
  KarmaComet Bot is here to streamline the recruitment process, ensuring every meeting, interview, and feedback session happens on time and as planned. Let's make recruitment more efficient and reliable!`;

  bot.sendMessage(chatId, greeting);
  bot.sendMessage(chatId, description);
  bot.sendMessage(chatId, "Type /register to get started.");
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
      registered_at: new Date().toISOString(),
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
      bot.sendMessage(chatId, 'You are now registered as an individual recruiter. It is time to schedule your first meeting! Type /meeting @username {meeting description} where {username} is the telegram name of the Job seeker and {meeting description} is any meeting details. If you want to switch back to Job Seeker role just type /setjobseeker');
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
    bot.sendMessage(chatId, `You are now registered as a company recruiter for ${companyName}. It is time to schedule your first meeting! Type /meeting @username {meeting description} where {username} is the telegram name of the Job seeker and {meeting description} is any meeting details. If you want to switch back to Job Seeker role just type /setjobseeker.`);
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

        bot.sendMessage(chatId, "Your role has been updated to job seeker. Your recruiter subscription status remains unchanged.");
      }
    } else {
      bot.sendMessage(chatId, "User not found. Please register first using /register <your_name>.");
    }
  } catch (error) {
    console.error('Error setting job seeker role:', error);
    bot.sendMessage(chatId, 'There was an error updating your role. Please try again.');
  }
});

// List of authorized user IDs or usernames for testing commands
const authorizedUsers = ['klngnv','kriskolgan']; // Add your username or user ID here

// Handle /reset command for testing purposes
bot.onText(/\/reset/, async (msg) => {
  console.log('/reset command received');
  const chatId = msg.chat.id;
  const userName = msg.from.username || 'User';

  // Check if the user is authorized
  if (!authorizedUsers.includes(userName)) {
    bot.sendMessage(chatId, 'You are not authorized to use this command.');
    return;
  }

  try {
    console.log(`Resetting user: ${userName} with chat ID: ${chatId}`);
    await db.collection('users').doc(chatId.toString()).set({
      name: userName,
      score: 0,
      userType: 'jobSeeker', // Reset to default user type
      subscription: {
        status: 'free',
        expiry: null
      }
    });
    console.log(`User ${userName} reset successfully.`);

    bot.sendMessage(chatId, `Your status has been reset. You are now a job seeker with a free subscription. You can change your role to recruiter if needed using /setrecruiter.`);
  } catch (error) {
    console.error('Error resetting user:', error);
    bot.sendMessage(chatId, 'There was an error processing your reset request. Please try again.');
  }
});

////*********************************////
//++// Handle meeting commitments //++//
////*******************************////

// Handle /meeting command
bot.onText(/\/meeting @(\w+) (.+)/, async (msg, match) => {
  console.log('/meeting command received');
  const chatId = msg.chat.id;
  const [counterpartUsername, description] = match.slice(1);
  console.log(`Meeting request by @${msg.from.username} for @${counterpartUsername} with description: ${description}`);

  try {
    const counterpartRef = await db.collection('users').where('name', '==', counterpartUsername).get();

    if (!counterpartRef.empty) {
      const counterpart = counterpartRef.docs[0];
      const counterpartId = counterpart.id;
      console.log(`Counterpart found: ${counterpartUsername} with ID: ${counterpartId}`);

      const recruiterCompanyName = msg.from.company_name || '';
      const recruiterName = msg.from.username;

      // Generate a unique meeting request ID
      const meetingRequestId = `${Date.now()}${Math.floor((Math.random() * 1000)+1)}`;

      // Store the meeting request in Firestore
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
        meeting_duration: null // Initialize meeting duration
      });
      console.log(`Meeting request stored in Firestore for meeting request ID: ${meetingRequestId}`);

      // Ask user to choose meeting duration
      const durations = ['30 minutes', '45 minutes', '1 hour', '1,5 hours', '2 hours'];

      const opts = {
        reply_markup: {
          inline_keyboard: durations.map(duration => [
            { text: duration, callback_data: `choose_duration_meeting_${meetingRequestId}_${duration}` }
          ])
        }
      };

      bot.sendMessage(chatId, 'Please choose the duration for the meeting:', opts);
    } else {
      console.log(`User @${counterpartUsername} not found.`);
      bot.sendMessage(chatId, `User @${counterpartUsername} not found.`);
    }
  } catch (error) {
    console.error('Error handling /meeting command:', error);
    bot.sendMessage(chatId, 'There was an error processing your request. Please try again.');
  }
});

// Handle callback for choosing time slots and other meeting-related actions
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data.split('_');

  console.log(`Callback query received: ${callbackQuery.data}`);

  if (data[0] === 'choose' && data[1] === 'duration' && data[2] === 'meeting') {
    const meetingRequestId = data[3];
    const duration = data.slice(4).join(' '); // Join the rest of the array to get the full duration text
    console.log(`Duration chosen: ${duration}, Meeting Request ID: ${meetingRequestId}`);

    try {
      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      await requestRef.update({ meeting_duration: duration });

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
          ])
        }
      };

      bot.sendMessage(chatId, 'Please choose the date for the meeting:', opts);
    } catch (error) {
      console.error('Error updating meeting duration:', error);
      bot.sendMessage(chatId, 'There was an error updating the meeting duration. Please try again.');
    }
  } else if (data[0] === 'choose' && data[1] === 'date' && data[2] === 'meeting') {
    const date = data[4];
    const meetingRequestId = data[3];
    console.log(`Date chosen: ${date}, Meeting Request ID: ${meetingRequestId}`);

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

    bot.sendMessage(chatId, `Please choose up to 5 available time slots for ${date}:`, opts);
  } else if (data[0] === 'add' && data[1] === 'timeslot' && data[2] === 'meeting') {
    const meetingRequestId = data[3];
    const date = data[4];
    const time = data[5];
    console.log(`Time slot chosen: ${date} ${time}, Meeting Request ID: ${meetingRequestId}`);

    try {
      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const timeSlots = request.data().timeslots;

        if (timeSlots.length < 5) {
          timeSlots.push(`${date} ${time}`);
          await requestRef.update({ timeslots: timeSlots });

          bot.sendMessage(chatId, `Added time slot: ${date} ${time}`);

          if (timeSlots.length >= 1) {
            // Ask user if they want to create the meeting request
            const opts = {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Submit Meeting Request', callback_data: `submit_meeting_${meetingRequestId}` }],
                  [{ text: 'Cancel', callback_data: `cancel_meeting_${meetingRequestId}` }]
                ]
              }
            };
            bot.sendMessage(chatId, 'Do you want to submit the meeting request now?', opts);
          }
        } else {
          bot.sendMessage(chatId, 'You have already selected 5 time slots.');
        }
      } else {
        bot.sendMessage(chatId, `Meeting request not found for ID: ${meetingRequestId}`);
      }
    } catch (error) {
      console.error('Error adding time slot:', error);
      bot.sendMessage(chatId, 'There was an error adding the time slot. Please try again.');
    }
  } else if (data[0] === 'submit' && data[1] === 'meeting') {
    const meetingRequestId = data[2];

    try {
      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const { recruiter_id, counterpart_id, description, timeslots, recruiter_name, counterpart_name, meeting_duration } = request.data();

        // Update request_submitted to true
        await requestRef.update({ request_submitted: true });

        // Send meeting request to counterpart
        await bot.sendMessage(counterpart_id, `You have a meeting request from @${recruiter_name}: ${description}. Meeting duration: ${meeting_duration}. Please choose one of the available time slots:`, {
          reply_markup: {
            inline_keyboard: timeslots.map(slot => [
              { text: `${slot.split(' ')[0]} ${slot.split(' ')[1]}`, callback_data: `accept_meeting_${meetingRequestId}_${slot}` }
            ]).concat([[{ text: 'Decline', callback_data: `decline_meeting_${meetingRequestId}` }]])
          }
        });

        bot.sendMessage(recruiter_id, `Meeting request sent to @${counterpart_name}.`);
      } else {
        bot.sendMessage(recruiter_id, 'Meeting request not found.');
      }
    } catch (error) {
      console.error('Error submitting meeting request:', error);
      bot.sendMessage(recruiter_id, 'There was an error submitting the meeting request. Please try again.');
    }
  } else if (data[0] === 'cancel' && data[1] === 'meeting') {
    const meetingRequestId = data[2];

    try {
      await db.collection('meetingRequests').doc(meetingRequestId).delete();
      bot.sendMessage(chatId, 'Meeting request cancelled.');
    } catch (error) {
      console.error('Error cancelling meeting request:', error);
      bot.sendMessage(chatId, 'There was an error cancelling the meeting request. Please try again.');
    }
  } else if (data[0] === 'accept' && data[1] === 'meeting') {
    const meetingRequestId = data[2];
    const selectedTimeSlot = data.slice(3).join(' ');

    try {
      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const { recruiter_id, counterpart_id, meeting_duration } = request.data();

        // Ensure selectedTimeSlot is correctly defined
        if (selectedTimeSlot && typeof selectedTimeSlot === 'string') {
          // Update counterpart_accepted to true and add selected time slot
          await requestRef.update({
            counterpart_accepted: true,
            selected_time_slot: selectedTimeSlot
          });

          // Create a meeting commitment
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
            meeting_scheduled_at: selectedTimeSlot,
            description: request.data().description,
            recruiter_commitment_state: 'pending_meeting',
            counterpart_commitment_state: 'pending_meeting',
            meeting_duration: meeting_duration // Include meeting duration
          });
                // Notify both parties
                bot.sendMessage(recruiter_id, `Your meeting request has been accepted by @${request.data().counterpart_name}. Meeting is scheduled at ${selectedTimeSlot}.`);
                bot.sendMessage(counterpart_id, `You have accepted the meeting request from @${request.data().recruiter_name}. Meeting is scheduled at ${selectedTimeSlot}.`);

                // Schedule feedback request generation after 2.5 hours
                setTimeout(async () => {
                    const commitmentRef = db.collection('meetingCommitments').doc(meetingCommitmentId);
                    const commitment = await commitmentRef.get();

                    if (commitment.exists) {
                        const feedbackRequestId = `${Date.now()}${Math.floor((Math.random() * 1000)+1)}`;
                        const feedbackDueDate = new Date();
                        feedbackDueDate.setHours(feedbackDueDate.getHours() + 2.5);

                        await db.collection('feedbackRequests').doc(feedbackRequestId).set({
                            feedback_request_id: feedbackRequestId,
                            recruiter_id: recruiter_id,
                            recruiter_name: request.data().recruiter_name,
                            counterpart_id: counterpart_id,
                            counterpart_name: request.data().counterpart_name,
                            feedback_request_created_at: new Date().toISOString(),
                            feedback_due_date: feedbackDueDate.toISOString(),
                            meeting_request_id: meetingRequestId,
                            meeting_commitment_id: meetingCommitmentId,
                            feedback_planned_at: null,
                            feedback_submitted: false
                        });

                        bot.sendMessage(recruiter_id, `Please specify the number of days you will take to provide feedback for the meeting "${commitment.data().description}" using the format: /feedbackdays <number_of_days>`);
                    }
                }, 2.5 * 60 * 60 * 1000); // 2.5 hours in milliseconds

            } else {
                bot.sendMessage(chatId, 'Invalid time slot selected.');
            }
        } else {
            bot.sendMessage(chatId, 'Meeting request not found.');
        }
    } catch (error) {
        console.error('Error accepting meeting request:', error);
        bot.sendMessage(chatId, 'There was an error accepting the meeting request. Please try again.');
    }
  } else if (data[0] === 'decline' && data[1] === 'meeting') {
    const meetingRequestId = data[2];

    try {
      const requestRef = db.collection('meetingRequests').doc(meetingRequestId);
      const request = await requestRef.get();

      if (request.exists) {
        const { recruiter_id } = request.data();

        // Update counterpart_accepted to false
        await requestRef.update({ counterpart_accepted: false });

        // Notify initiator
        bot.sendMessage(recruiter_id, `Your meeting request has been declined by @${request.data().counterpart_name}.`);

        bot.sendMessage(chatId, 'You have declined the meeting request.');
      } else {
        bot.sendMessage(chatId, 'Meeting request not found.');
      }
    } catch (error) {
      console.error('Error declining meeting request:', error);
      bot.sendMessage(chatId, 'There was an error declining the meeting request. Please try again.');
    }
  } else if (data[0] === 'approve' && data[1] === 'feedback') {
    const feedbackRequestId = data[2];
    const feedbackDueDate = data[3];

    try {
      const feedbackRequestRef = db.collection('feedbackRequests').doc(feedbackRequestId);
      const feedbackRequest = await feedbackRequestRef.get();

      if (feedbackRequest.exists) {
        const { counterpart_id, recruiter_name, counterpart_name, meeting_request_id, meeting_commitment_id } = feedbackRequest.data();

        await feedbackRequestRef.update({ feedback_planned_at: feedbackDueDate, feedback_submitted: true });

        // Create feedback commitment
        const feedbackCommitmentId = `${Date.now()}${Math.floor((Math.random() * 100)+1)}`;
        await db.collection('feedbackCommitments').doc(feedbackCommitmentId).set({
          feedback_commitment_id: feedbackCommitmentId,
          feedback_request_id: feedbackRequestId,
          recruiter_id: feedbackRequest.data().recruiter_id,
          recruiter_name: recruiter_name,
          counterpart_id: counterpart_id,
          counterpart_name: counterpart_name,
          meeting_request_id: meeting_request_id,
          meeting_commitment_id: meeting_commitment_id,
          feedback_planned_at: feedbackDueDate,
          recruiter_commitment_state: 'pending_feedback',
          counterpart_commitment_state: 'pending_feedback'
        });

        bot.sendMessage(counterpart_id, `The recruiter will provide feedback by ${new Date(feedbackDueDate).toLocaleString()}.`);
        bot.sendMessage(chatId, 'Feedback request approved.');
      } else {
        bot.sendMessage(chatId, 'Feedback request not found.');
      }
    } catch (error) {
      console.error('Error approving feedback request:', error);
      bot.sendMessage(chatId, 'There was an error approving the feedback request. Please try again.');
    }
  } else if (data[0] === 'decline' && data[1] === 'feedback') {
    const feedbackRequestId = data[2];

    try {
      const feedbackRequestRef = db.collection('feedbackRequests').doc(feedbackRequestId);
      const feedbackRequest = await feedbackRequestRef.get();

      if (feedbackRequest.exists) {
        await feedbackRequestRef.delete();

        bot.sendMessage(feedbackRequest.data().recruiter_id, 'Your feedback request was declined by the job seeker.');
        bot.sendMessage(chatId, 'You have declined the feedback request.');
      } else {
        bot.sendMessage(chatId, 'Feedback request not found.');
      }
    } catch (error) {
      console.error('Error declining feedback request:', error);
      bot.sendMessage(chatId, 'There was an error declining the feedback request. Please try again.');
    }
  }
});

// Handle /feedbackdays command
bot.onText(/\/feedbackdays (\d+)/, async (msg, match) => {
  console.log('/feedbackdays command received');
  const chatId = msg.chat.id;
  const [days] = match.slice(1);

  try {
    const feedbackRequestRef = db.collection('feedbackRequests').doc(feedbackRequestId);
    const feedbackRequest = await feedbackRequestRef.get();

    if (feedbackRequest.exists) {
      const feedbackDueDate = new Date();
      feedbackDueDate.setDate(feedbackDueDate.getDate() + parseInt(days));

      await feedbackRequestRef.update({ feedback_due_date: feedbackDueDate.toISOString() });

      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Approve', callback_data: `approve_feedback_${feedbackRequestId}_${feedbackDueDate.toISOString()}` },
              { text: 'Decline', callback_data: `decline_feedback_${feedbackRequestId}` }
            ]
          ]
        }
      };

      bot.sendMessage(feedbackRequest.data().counterpart_id, `You have a feedback request from @${msg.from.username} for the meeting "${feedbackRequest.data().description}". Feedback will be provided by ${feedbackDueDate.toLocaleString()}. Do you approve?`, opts);
    } else {
      bot.sendMessage(chatId, 'Feedback request not found.');
    }
  } catch (error) {
    console.error('Error handling feedback days:', error);
    bot.sendMessage(chatId, 'There was an error processing your request. Please try again.');
  }
});

////*************************************////
// Users, Meetings and Feednack status check
////************************************////

// Handle /userinfo command
bot.onText(/\/userinfo/, async (msg) => {
  console.log('/userinfo command received');
  const chatId = msg.chat.id;

  try {
      const userRef = db.collection('users').doc(chatId.toString());
      const user = await userRef.get();

      if (user.exists) {
          const userData = user.data();
          let responseMessage = `Username: ${userData.name}\n`;
          responseMessage += `Member since: ${userData.registered_at}\n`;
          responseMessage += `User Type: ${userData.userType}\n`;
          if (userData.userType === 'recruiter') {
              responseMessage += `Recruiter Type: ${userData.recruiterType}\n`;
              if (userData.recruiterType === 'company') {
                  responseMessage += `Company Name: ${userData.companyName}\n`;
              }
          }
          responseMessage += `Subscription Status: ${userData.subscription.status}\n`;
          if (userData.subscription.expiry) {
              responseMessage += `Subscription Expiry: ${userData.subscription.expiry}\n`;
          }
          responseMessage += `Score: ${userData.score}\n`;

          bot.sendMessage(chatId, responseMessage);
      } else {
          bot.sendMessage(chatId, 'User not found. Please register first using /register.');
      }
  } catch (error) {
      console.error('Error handling /userinfo command:', error);
      bot.sendMessage(chatId, 'There was an error processing your request. Please try again.');
  }
});

// Handle /meetingstatus command
bot.onText(/\/meetingstatus/, async (msg) => {
  console.log('/meetingstatus command received');
  const chatId = msg.chat.id;
  const now = new Date();

  try {
      // Retrieve meeting commitments where the user is either the recruiter or the job seeker
      const recruiterMeetings = await db.collection('meetingCommitments').where('recruiter_id', '==', chatId).get();
      const jobSeekerMeetings = await db.collection('meetingCommitments').where('counterpart_id', '==', chatId).get();

      const upcomingMeetings = [];
      recruiterMeetings.forEach(doc => {
          const data = doc.data();
          const meetingTime = new Date(data.meeting_scheduled_at);
          if (meetingTime > now.setHours(now.getHours() - 2)) {
              upcomingMeetings.push(data);
          }
      });

      jobSeekerMeetings.forEach(doc => {
          const data = doc.data();
          const meetingTime = new Date(data.meeting_scheduled_at);
          if (meetingTime > now.setHours(now.getHours() - 2)) {
              upcomingMeetings.push(data);
          }
      });

      upcomingMeetings.sort((a, b) => new Date(a.meeting_scheduled_at) - new Date(b.meeting_scheduled_at));

      if (upcomingMeetings.length > 0) {
          let responseMessage = 'Scheduled Meetings:\n';
          upcomingMeetings.forEach((meeting, index) => {
              responseMessage += `${index + 1}. Job Seeker Name: ${meeting.counterpart_name}\n`;
              responseMessage += `   Recruiter Name: ${meeting.recruiter_name}\n`;
              responseMessage += `   Meeting Scheduled Time: ${meeting.meeting_scheduled_at}\n`;
              responseMessage += `   Description: ${meeting.description}\n\n`;
          });
          bot.sendMessage(chatId, responseMessage);
      } else {
          bot.sendMessage(chatId, 'No upcoming meetings found.');
      }
  } catch (error) {
      console.error('Error handling /meetingstatus command:', error);
      bot.sendMessage(chatId, 'There was an error processing your request. Please try again.');
  }
});

// Handle /meetinghistory command
bot.onText(/\/meetinghistory/, async (msg) => {
  console.log('/meetinghistory command received');
  const chatId = msg.chat.id;
  const now = new Date();

  try {
      // Retrieve meeting commitments where the user is either the recruiter or the job seeker
      const recruiterMeetings = await db.collection('meetingCommitments').where('recruiter_id', '==', chatId).get();
      const jobSeekerMeetings = await db.collection('meetingCommitments').where('counterpart_id', '==', chatId).get();

      const pastMeetings = [];
      recruiterMeetings.forEach(doc => {
          const data = doc.data();
          const meetingTime = new Date(data.meeting_scheduled_at);
          if (meetingTime <= now.setHours(now.getHours() - 2)) {
              pastMeetings.push(data);
          }
      });

      jobSeekerMeetings.forEach(doc => {
          const data = doc.data();
          const meetingTime = new Date(data.meeting_scheduled_at);
          if (meetingTime <= now.setHours(now.getHours() - 2)) {
              pastMeetings.push(data);
          }
      });

      pastMeetings.sort((a, b) => new Date(a.meeting_scheduled_at) - new Date(b.meeting_scheduled_at));

      if (pastMeetings.length > 0) {
          let responseMessage = 'Meeting History:\n';
          pastMeetings.forEach((meeting, index) => {
              responseMessage += `${index + 1}. Job Seeker Name: ${meeting.counterpart_name}\n`;
              responseMessage += `   Recruiter Name: ${meeting.recruiter_name}\n`;
              responseMessage += `   Meeting Scheduled Time: ${meeting.meeting_scheduled_at}\n`;
              responseMessage += `   Description: ${meeting.description}\n\n`;
          });
          bot.sendMessage(chatId, responseMessage);
      } else {
          bot.sendMessage(chatId, 'No past meetings found.');
      }
  } catch (error) {
      console.error('Error handling /meetinghistory command:', error);
      bot.sendMessage(chatId, 'There was an error processing your request. Please try again.');
  }
});

// Handle /feedbackstatus command
bot.onText(/\/feedbackstatus/, async (msg) => {
  console.log('/feedbackstatus command received');
  const chatId = msg.chat.id;

  try {
      const feedbackCommitments = await db.collection('feedbackCommitments').where('recruiter_id', '==', chatId).get();

      if (!feedbackCommitments.empty) {
          let responseMessage = 'Scheduled Feedbacks:\n';
          feedbackCommitments.forEach(doc => {
              const data = doc.data();
              responseMessage += `Job Seeker Name: ${data.counterpart_name}\n`;
              responseMessage += `Recruiter Name: ${data.recruiter_name}\n`;
              responseMessage += `Feedback Due Date: ${data.feedback_planned_at}\n\n`;
          });
          bot.sendMessage(chatId, responseMessage);
      } else {
          bot.sendMessage(chatId, 'No scheduled feedbacks found.');
      }
  } catch (error) {
      console.error('Error handling /feedbackstatus command:', error);
      bot.sendMessage(chatId, 'There was an error processing your request. Please try again.');
  }
});

////***************************************////
// Commitment status updates and scoring logic
////**************************************////

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
            expiryDate.setDate(expiryDate.getDate() + 14);

            await userRef.update({
              subscription: {
                status: 'trial',
                expiry: expiryDate
              }
            });

            bot.sendMessage(chatId, `Your status for meeting commitment "${commitment.data().description}" has been updated to ${status}. Your new score is ${newScore}. Your free trial period has started and will expire on ${expiryDate}.`);

            // Automatically create feedback request after 2.5 hours
            setTimeout(async () => {
              bot.sendMessage(chatId, `Please specify the number of days you will take to provide feedback for the meeting "${commitment.data().description}" using the format: /feedbackdays <number_of_days>_${commitmentId}`);
            }, 2.5 * 60 * 60 * 1000); // 2.5 hours in milliseconds
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

        if (status === 'fulfilled') {
          const newScore = user.data().score + 10;
          await userRef.update({ score: newScore });
          await commitmentRef.update({ [`${userType}_commitment_state`]: 'fulfilled' });
        } else if (status === 'missed') {
          const newScore = user.data().score - 10;
          await userRef.update({ score: newScore });
          await commitmentRef.update({ [`${userType}_commitment_state`]: 'missed' });
        }

        const counterpartId = commitmentData[`${counterpartType}_id`];
        const user = await userRef.get();

        if (user.exists) {
          const opts = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Attended', callback_data: `review_${commitmentId}_attended` },
                  { text: 'Missed', callback_data: `review_${commitmentId}_missed` }
                ]
              ]
            }
          };

          bot.sendMessage(counterpartId, `Update your commitment status for "${commitment.data().description}":`, opts);
        }

        bot.sendMessage(chatId, `Your commitment status for "${commitment.data().description}" has been updated to ${status}.`);
      } else {
        bot.sendMessage(chatId, 'Commitment not found.');
      }
    } catch (error) {
      console.error('Error updating review status:', error);
      bot.sendMessage(chatId, 'There was an error updating the review status. Please try again.');
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

// Function to send meeting reminders
const sendMeetingReminders = async () => {
    console.log('Sending meeting reminders...');
    const now = new Date();
    const meetings = await db.collection('meetingCommitments').get();

    meetings.forEach(async (doc) => {
        const meeting = doc.data();
        const meetingDate = new Date(meeting.meeting_scheduled_at);

        // Reminder 24 hours before
        if (meetingDate > now && (meetingDate - now) <= 24 * 60 * 60 * 1000) {
            bot.sendMessage(meeting.recruiter_id, `Reminder: You have a meeting "${meeting.description}" with ${meeting.counterpart_name} scheduled on ${meeting.meeting_scheduled_at}.`);
            bot.sendMessage(meeting.counterpart_id, `Reminder: You have a meeting "${meeting.description}" with ${meeting.recruiter_name} scheduled on ${meeting.meeting_scheduled_at}.`);
        }

        // Reminder 1 hour before
        if (meetingDate > now && (meetingDate - now) <= 1 * 60 * 60 * 1000) {
            bot.sendMessage(meeting.recruiter_id, `Reminder: Your meeting "${meeting.description}" with ${meeting.counterpart_name} is happening in 1 hour.`);
            bot.sendMessage(meeting.counterpart_id, `Reminder: Your meeting "${meeting.description}" with ${meeting.recruiter_name} is happening in 1 hour.`);
        }
    });
};

// Function to send feedback reminders
const sendFeedbackReminders = async () => {
    console.log('Sending feedback reminders...');
    const now = new Date();
    const feedbacks = await db.collection('feedbackCommitments').get();

    feedbacks.forEach(async (doc) => {
        const feedback = doc.data();
        const feedbackDate = new Date(feedback.feedback_scheduled_at);

        // Reminder 24 hours before
        if (feedbackDate > now && (feedbackDate - now) <= 24 * 60 * 60 * 1000) {
            bot.sendMessage(feedback.recruiter_id, `Reminder: You need to provide feedback for your meeting with ${feedback.counterpart_name} by ${feedback.feedback_scheduled_at}.`);
            bot.sendMessage(feedback.counterpart_id, `Reminder: ${feedback.recruiter_name} needs to provide feedback for your meeting by ${feedback.feedback_scheduled_at}.`);
        }

        // Reminder 1 hour before
        if (feedbackDate > now && (feedbackDate - now) <= 1 * 60 * 60 * 1000) {
            bot.sendMessage(feedback.recruiter_id, `Reminder: Your feedback for the meeting with ${feedback.counterpart_name} is due in 1 hour.`);
            bot.sendMessage(feedback.counterpart_id, `Reminder: ${feedback.recruiter_name}'s feedback for your meeting is due in 1 hour.`);
        }
    });
};

// Schedule the reminder functions to run every hour
schedule.scheduleJob('0 * * * *', sendMeetingReminders);
schedule.scheduleJob('0 * * * *', sendFeedbackReminders);

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
