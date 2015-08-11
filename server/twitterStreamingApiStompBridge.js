// Simple Twitter/STOMP bridge that listens to Twitter stream and publishes STOMP messages every X milliseconds
// NB. Based very loosely on Stephen Blum's Twitter/PubNub bridge https://gist.github.com/stephenlb/36aef15a165d5bad0d82


// initialisation
var twit = require('twit'), // https://github.com/ttezel/twit
    diffusion = require('diffusion'),
    nconf = require('nconf'), // https://github.com/flatiron/nconf
    session,
    twitterStream,
    controlDestination = 'twitter_stream_rate_control',
    notificationsDestination = 'twitter_notifications',
    publishDestination = 'twitter_stream',
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

var diffusionConfig = {
    // localhost
    host: nconf.get('DIFFUSION_HOST'),
    port: nconf.get('DIFFUSION_PORT'),

    // Reappt
    //host: nconf.get('REAPPT_HOST'),
    //port: nconf.get('REAPPT_PORT'),

    secure: nconf.get('DIFFUSION_SECURE'),
    principal: nconf.get('DIFFUSION_PRINCIPAL'),
    credentials: nconf.get('DIFFUSION_PASSWORD')
};


// handle CTRL+C gracefully
process.on('SIGINT', function() {
    tidyUp();
    process.exit(0);
});


// main prog
connectToDiffusion();
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
function connectToDiffusion() {
    console.log('Connecting to Diffusion...');
    diffusion.connect(diffusionConfig).then(onDiffusionConnect, onDiffusionConnectError);
}

function onDiffusionConnect(diffusionSession) {
    console.log('Connected to Diffusion');
    session = diffusionSession;
    session.topics.add(notificationsDestination);
    session.topics.add(publishDestination);
    session.subscribe(controlDestination).transform(JSON.parse).on('update', onRateControlMessage);
}

function onDiffusionConnectError(error) {
    console.log(error);
    tidyUp();
    process.exit(0);
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

    session.topics.update(publishDestination, JSON.stringify(tidyTweet(tweet)));
    publishTweetCompletes++; // rate test
    publishTotal++; // rate test
}

function tidyTweet(tweet) {
    return {
        text: tweet.text,
        source: tweet.source,
        user_id_str: tweet.user ? tweet.user.id_str : null,
        user_screen_name: tweet.user ? tweet.user.screen_name : null,
        user_profile_image_url: tweet.user ? tweet.user.profile_image_url : null,
        user_geo_enabled: tweet.user ? tweet.user.geo_enabled : null,
        place_country_code: tweet.place ? tweet.place.country_code : null,
        place_full_name: tweet.place ? tweet.place.full_name : null,
        favorited: tweet.favorited,
        retweeted: tweet.retweeted,
        possibly_sensitive: tweet.possibly_sensitive,
        filter_level: tweet.filter_level
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

function onRateControlMessage(message) {

    // if rate is valid then update publication rate // TODO: add defensive coding to prevent failure in the event of poorly formatted messages being received
    var newPublishIntervalMilliseconds = 0,
        tweetsPerSecondMaxRate = parseInt(message.maxTweetRate, 10);

    if (typeof tweetsPerSecondMaxRate === 'number' && tweetsPerSecondMaxRate > 0 && tweetsPerSecondMaxRate <= 50) {
        newPublishIntervalMilliseconds = Math.floor(1000 / tweetsPerSecondMaxRate);
        clearInterval(publishIntervalId);
        publishIntervalId = setInterval(publishTweet, newPublishIntervalMilliseconds);

        // broadcast max rate change notification to connected clients
        var notification = {
            newMaxRate: tweetsPerSecondMaxRate,
            rateChangeUserId: message.userId,
            broadcastMessage: 'Max tweet publication rate set at ' + tweetsPerSecondMaxRate + ' per second'
        };

        session.topics.update(notificationsDestination, JSON.stringify(notification));
        console.log(notification.broadcastMessage + ' by user ' + notification.rateChangeUserId);
    }
    else {
        console.log('Invalid max tweet rate request received');
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