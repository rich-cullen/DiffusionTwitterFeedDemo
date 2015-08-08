// Simple Twitter/STOMP bridge that listens to Twitter stream and publishes STOMP messages every X milliseconds
// NB. Based very loosely on Stephen Blum's Twitter/PubNub bridge https://gist.github.com/stephenlb/36aef15a165d5bad0d82


// initialisation
var twit = require('twit'), // https://github.com/ttezel/twit
    stomp = require('stomp'), // https://github.com/benjaminws/stomp-js
    nconf = require('nconf'), // https://github.com/flatiron/nconf
    stompClient,
    twitterStream,
    controlDestination = '/topic/twitter_stream_rate_control',
    controlDestinationHeaders = {
        destination: controlDestination,
        ack: 'auto'
    },
    notificationsDestination = '/topic/twitter_notifications',
    publishDestinationFull = '/topic/twitter_stream',
    publishDestinationDelta = '/topic/twitter_stream_delta',
    publishIntervalId = null,
    publishIntervalMilliseconds = 200, // default to max rate of 5 tweets per second (configurable from the UI)
    tweetQueue = [],
    tweetQueueMaxSize = 100,
    twitterStreamingApiFilterParams = { // https://dev.twitter.com/streaming/overview/request-parameters#locations
        // locations : '-170, 25, -65, 70' // roughly geofence USA
        locations : '-15, 35, 45, 65' // roughly geofence western Europe
        // locations : '-180, -90, 180, 90' // entire globe
    },
    // rate testing
    debug = true,
    onTweets = 0,
    publishTweetStarts = 0,
    publishTweetCompletes = 0,
    publishTotal = 0,
    misfires = 0,
    misfireTotal = 0;


// config
nconf.file( {
    file: __dirname + '/twitterStreamingApiStompBridgeConfig.json'
});

var twitterConfig = {
        consumer_key: nconf.get('TWITTER_CONSUMER_KEY'),
        consumer_secret: nconf.get('TWITTER_CONSUMER_SECRET'),
        access_token: nconf.get('TWITTER_ACCESS_TOKEN'),
        access_token_secret: nconf.get('TWITTER_ACCESS_TOKEN_SECRET')
    };

var activeMqConfig = {
        host: nconf.get('ACTIVEMQ_HOST'),
        port: nconf.get('ACTIVEMQ_PORT'),
        debug: nconf.get('ACTIVEMQ_DEBUG'),
        login: nconf.get('ACTIVEMQ_USERNAME'),
        passcode: nconf.get('ACTIVEMQ_PASSWORD'),
    };


// handle CTRL+C gracefully
process.on('SIGINT', function() {
    tidyUp();
    process.exit(0);
});


// main prog
connectToMessageBroker();
connectToTwitterPublicStream();

// rate test
if (debug) {
    setInterval(displayDebugStats, 1000);
}

function displayDebugStats() {
    console.log(Date.now());
    console.log('onTweets    : ' + onTweets);
    console.log('publishTweetStarts: ' + publishTweetStarts);
    console.log('publishTweetCompletes: ' + publishTweetCompletes);
    console.log('misfires: ' + misfires);
    console.log('tweetQueue length: ' + tweetQueue.length);
    console.log('publishTotal: ' + publishTotal);
    console.log('misfireTotal: ' + misfireTotal);
    console.log();
    onTweets = publishTweetStarts = publishTweetCompletes = misfires = 0;
}

publishIntervalId = setInterval(publishTweet, publishIntervalMilliseconds);

// function definitions
function connectToMessageBroker() {
    console.log('Connecting to message broker...');

    stompClient = new stomp.Stomp(activeMqConfig);

    stompClient.on('error', function (error_frame) {
        console.log(error_frame.body);
        tidyUp();
        process.exit(0);
    });

    stompClient.on('message', onStompMessage);

    stompClient.on('connected', function () {
        console.log('Connected to message broker');
        stompClient.subscribe(controlDestinationHeaders);
    });

    stompClient.connect();
}

function connectToTwitterPublicStream() {
    console.log('Connecting to Twitter public stream...');

    var twitter = new twit(twitterConfig);

    twitterStream = twitter.stream('statuses/filter', twitterStreamingApiFilterParams);
    console.log('Connected to Twitter public stream');

    twitterStream.on('tweet', onTweet);
}

function publishTweet() {

    publishTweetStarts++; // rate test

    var tweet = tweetQueue.shift();

    if (tweet === undefined || isEmptyObject(tweet)) {
        misfires++; // rate test
        misfireTotal++; // rate test
        return;
    }

    var stompMessageFull = constructStompTweetMessage(tweet, publishDestinationFull);
    var stompMessageDelta = constructStompTweetMessage(tweet, publishDestinationDelta);
    stompClient.send(stompMessageFull, false);
    stompClient.send(stompMessageDelta, false);

    publishTweetCompletes++; // rate test
    publishTotal++; // rate test
}

function constructStompTweetMessage(tweet, destination) {
    return {
        destination: destination,
        persistent: false,
        body: tweet.text,
        t_source: tweet.source,
        t_user_id_str: tweet.user ? tweet.user.id_str : null,
        t_user_screen_name: tweet.user ? tweet.user.screen_name : null,
        t_user_profile_image_url: tweet.user ? tweet.user.profile_image_url : null,
        t_user_geo_enabled: tweet.user ? tweet.user.geo_enabled : null,
        t_place_country_code: tweet.place ? tweet.place.country_code : null,
        t_place_full_name: tweet.place ? tweet.place.full_name : null,
        t_favorited: tweet.favorited,
        t_retweeted: tweet.retweeted,
        t_possibly_sensitive: tweet.possibly_sensitive,
        t_filter_level: tweet.filter_level
    }
}


// event handlers
function onTweet(tweet) {
    onTweets++; // rate test

    if (tweetQueue.length >= tweetQueueMaxSize) {
        tweetQueue.shift();
    }

    tweetQueue.push(tweet);
}

function onStompMessage(message) {
    if (message.headers.destination == controlDestination) {

        // if rate is valid then update publication rate // TODO: add defensive coding to prevent failure in the event of poorly formatted messages being received
        var newPublishIntervalMilliseconds = 0,
            messageBody = JSON.parse(message.body),
            tweetsPerSecondMaxRate = parseInt(messageBody.maxTweetRate, 10);

        if (typeof tweetsPerSecondMaxRate === 'number' && tweetsPerSecondMaxRate > 0 && tweetsPerSecondMaxRate <= 50) {
            newPublishIntervalMilliseconds = Math.floor(1000 / tweetsPerSecondMaxRate);
            clearInterval(publishIntervalId);
            publishIntervalId = setInterval(publishTweet, newPublishIntervalMilliseconds);

            // broadcast max rate change notification to connected clients
            var notification = {
                newMaxRate: tweetsPerSecondMaxRate,
                rateChangeUserId: messageBody.userId,
                broadcastMessage: 'Max tweet publication rate set at ' + tweetsPerSecondMaxRate + ' per second'
            };

            stompClient.send({
                destination: notificationsDestination,
                body: JSON.stringify(notification),
                persistent: false
            }, false);

            console.log(notification.broadcastMessage + ' by user ' + notification.rateChangeUserId);
        }
        else {
            console.log('Invalid max tweet rate request received');
        }
    }
}


// clean shutdown
function tidyUp() {
    if (stompClient) {
        stompClient.disconnect();
        console.log('Disconnected from message broker');
    }

    if (twitterStream) {
        twitterStream.stop();
        console.log('Disconnected from Twitter stream');
    }

    if (debug) {
        displayDebugStats();
    }
}

// utility functions
function isEmptyObject(obj) {
    return !Object.keys(obj).length;
}