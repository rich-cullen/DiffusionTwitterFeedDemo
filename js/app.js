$(function () {
    'use strict';

    // console object stub for IE8 with no dev tools open etc
    if(typeof console === 'undefined') {
        console = { log: function() { } };
    }

    // 'globals'
    var useReappt = false,
        session,
        twitterStreamTopicName = 'twitter_stream',
        twitterStreamRateControlTopicName = 'twitter_stream_rate_control',
        logTweets = false, // TODO make configurable
        notificationsTopicName = 'twitter_notifications',
        isSubscribedToTwitterStream = false,
        countries = [],
        countryCodes = [],
        enableChartAnimation = true, // TODO: make configurable based on user agent or via query string param etc
        countryTweetsBarChart,
        barChartData,
        barChartOptions,
        barChartSteps,
        barChartStepWidth,
        barChartStartValue,
        isBarChartBeingRecalibrated = false,
        countryTweetsPieChart,
        tweetTotalCountry = 0,
        tweetTotalOther = 0,
        $spanTweetTotalCountry = $('#spanTweetTotalCountry'),
        $spanTweetTotalOther = $('#spanTweetTotalOther'),
        $btnStart = $('#btnStart'),
        $btnStop = $('#btnStop'),
        $radioButtonGroupMaxTweetRate = $('input[type=radio][name=maxTweetRate]'),
        $linkBootstrapStyle = $('#linkBootstrapStyle'),
        availableStyles = ['bootstrap', 'bootstrap-theme-cosmo', 'bootstrap-theme-slate', 'bootstrap-theme-superhero', 'bootstrap-theme-cyborg'],
        currentStyle = 0,
        userId = generateGuid(),
        diffusionMaximumTimeoutDuration = 1000 * 60 * 10,
        diffusionMaxAttemptInterval = 1000 * 60,
        diffusionReconnectionStrategy = (function() {
            var attempts = 0;

            return function(start, abort) {
                var wait = Math.min(Math.pow(2, attempts++) * 100, diffusionMaxAttemptInterval);
                console.log('waiting for: ' + wait + 'ms');

                // Wait and then try to start the reconnection attempt
                setTimeout(start, wait);
            };
        })(),
        diffusionConfig = {
            host: useReappt ? 'burningnotableMerry.us.reappt.io' : 'localhost',
            port: useReappt ? 80: 8080,
            secure: false,
            principal: 'admin', // TODO: authenticating as admin just for demo purposes!!!
            credentials: 'password',
            reconnect: {
                timeout: diffusionMaximumTimeoutDuration,
                strategy: diffusionReconnectionStrategy
            }
        };

    // register event handlers
    $btnStart.on('click', function (event) {
        subscribeToTwitterStream();
        $btnStart.attr('disabled', 'disabled').removeClass('btn-success');
        $btnStop.removeAttr('disabled').addClass('btn-danger');
        toastr.success('Actively monitoring Twitter feed');
    });

    $btnStop.on('click', function (event) {
        unsubscribeFromTwitterStream();
        $btnStop.attr('disabled', 'disabled').removeClass('btn-danger');
        $btnStart.removeAttr('disabled').addClass('btn-success');
        toastr.info('Twitter feed monitoring suspended');
    });

    $radioButtonGroupMaxTweetRate.change(function() {
        setMaxTweetRate($(this).val());
    });

    $('#btnChangeStyle').on('click', function (event) {
        currentStyle++;
        if (currentStyle >= availableStyles.length) { currentStyle = 0; }
        $linkBootstrapStyle.attr('href', 'css/' + availableStyles[currentStyle] + '.min.css');
    });


    // main prog
    initialiseCountryData();
    initialiseBarChart();
    initialisePieChart();
    connectToDiffusion();


    // miscellaneous main function definitions
    function initialiseCountryData() {
        countries = [
            //{
            //    code : 'BE',
            //    name : 'Belgium'
            //},
            {
                code : 'FR',
                name : 'France'
            },
            {
                code : 'DE',
                name : 'Germany'
            },
            {
                code : 'IE',
                name : 'Ireland'
            },
            {
                code : 'IT',
                name : 'Italy'
            },
            {
                code : 'NL',
                name : 'Netherlands'
            },
            {
                code : 'PL',
                name : 'Poland'
            },
            {
                code : 'ES',
                name : 'Spain'
            },
            {
                code : 'SE',
                name : 'Sweden'
            },
            //{
            //    code : 'CH',
            //    name : 'Switzerland'
            //},
            {
                code : 'GB',
                name : 'UK'
            }
        ]

        for (var i = 0, j = countries.length; i < j; i++) {
            countries[i].tweets = 0;
        }

        countryCodes = getCountryCodes();
    }

    function initialiseBarChart() {
        barChartSteps = 10;
        barChartStepWidth = 2;
        barChartStartValue = 0;
        setBarChartOptions(barChartSteps, barChartStepWidth, barChartStartValue);
        setBarChartData(getCountryNames(), getCountryTweetTotals());
        renderBarChart();
    }

    function setBarChartOptions(steps, stepWidth, startValue) {
        barChartOptions = {
            animation: enableChartAnimation,
            scaleOverride : true,
            scaleSteps : steps,
            scaleStepWidth : stepWidth,
            scaleStartValue : startValue
        }
    }

    function setBarChartData(labels, data) {
        barChartData = {
            labels: labels,
            datasets: [
                {
                    label: 'Tweets by country',
                    fillColor: 'rgba(151,187,205,0.5)',
                    strokeColor: 'rgba(151,187,205,0.8)',
                    highlightFill: 'rgba(151,187,205,0.75)',
                    highlightStroke: 'rgba(151,187,205,1)',
                    data: data
                }
            ]
        }
    }

    function renderBarChart() {
        var ctx = $('#countryTweetsBarChart').get(0).getContext('2d');
        countryTweetsBarChart = new Chart(ctx).Bar(barChartData, barChartOptions);
    }

    function initialisePieChart() {

        var pieChartData = [],
            segment = {};

        for (var i = 0, j = countries.length; i < j; i++) {
            segment = {};
            segment.value = countries[i].tweets;
            segment.color = generateRandomRgbaCode();
            segment.highlight = segment.color.substring(0, segment.color.length -2) + '8)'; // bit hacky but change alpha from 0.5 to 0.8
            segment.label = countries[i].name;
            pieChartData.push(segment);
        }

        var pieChartOptions = {
            animation: enableChartAnimation,
            legendTemplate : '<ul class="<%=name.toLowerCase()%>-legend list-unstyled"><% for (var i=0; i<segments.length; i++){%><li><span style="background-color:<%=segments[i].fillColor%>">&nbsp;&nbsp;&nbsp;&nbsp;</span>&nbsp;&nbsp;&nbsp;&nbsp;<%if(segments[i].label){%><%=segments[i].label%><%}%></li><%}%></ul>'
        };

        renderPieChart(pieChartData, pieChartOptions);
    }

    function renderPieChart(data, options) {
        var ctx = $('#countryTweetsPieChart').get(0).getContext('2d');
        countryTweetsPieChart = new Chart(ctx).Pie(data, options);
        $('#countryTweetsPieChartLegend').html(countryTweetsPieChart.generateLegend()); // TODO: Style this
    }

    function connectToDiffusion() {
        diffusion.connect(diffusionConfig).then(onConnection, onError);
    }

    function onError(e) {
        toastr.error(e.message, 'Application error!');
        console.log('ERROR: ' + e.message);
    }

    function onConnection(diffusionSession) {
        session = diffusionSession;
        session.on('disconnect', function () {
            toastr.error('Connection to Diffusion lost', 'Application error!')
        });
        session.on('reconnect', function () { // TODO: this is not being called, presumably session has died and need another hook for reconnect?
            toastr.success('Connection to Diffusion successfully re-established', 'Reconnected');
        });
        createMaxTweetRateTopic();
        setMaxTweetRate(5);
        $btnStart.removeAttr('disabled').addClass('btn-success');
        $radioButtonGroupMaxTweetRate.parent().removeClass('disabled');
        toastr.success('Connection to Diffusion initiated successfully', 'Connected');
        console.log('Connected');

        subscribeToNotifications();
    }

    function createMaxTweetRateTopic() {
        session.topics.add(twitterStreamRateControlTopicName);
    }

    function setMaxTweetRate(maxTweetRate) {
        var msgBody = {
                maxTweetRate: maxTweetRate,
                userId: userId
            };

        session.topics.update(twitterStreamRateControlTopicName, JSON.stringify(msgBody));
    }

    function subscribeToTwitterStream() {
        session.subscribe(twitterStreamTopicName).transform(JSON.parse).on('update', onTweet);
        isSubscribedToTwitterStream = true;
        console.log('Subscribed to topic: ' + twitterStreamTopicName);
    }

    function unsubscribeFromTwitterStream() {
        session.unsubscribe(twitterStreamTopicName);
        isSubscribedToTwitterStream = false;
        console.log('Unsubscribed from topic: ' + twitterStreamTopicName);
    }

    function subscribeToNotifications() {
        session.subscribe(notificationsTopicName).transform(JSON.parse).on('update', onNotification);
        console.log('Subscribed to topic: ' + notificationsTopicName);
    }

    function onTweet(tidiedTweet) {
        var tweet = extractTweet(tidiedTweet);
        var countryIndex = $.inArray(tweet.place.country_code, countryCodes); // check this is a country we're interested in
        if (countryIndex == -1) {
            tweetTotalOther++;
            $spanTweetTotalOther.text(tweetTotalOther);
            return;
        }

        // check if any redrawing already underway before attempting to update charts, otherwise ignore tweet
        if (!isBarChartBeingRecalibrated) {
            tweetTotalCountry++;
            $spanTweetTotalCountry.text(tweetTotalCountry);
            countries[countryIndex].tweets++;
            updateBarChart(countryIndex);
            updatePieChart(countryIndex);
            if (logTweets) {
                //toastr.warning(tweet.place.country_code + ': @' + tweet.user.screen_name + ': ' + tweet.text); // TODO: placeholder for proper tweet display
                console.log(tweet.place.country_code + ': @' + tweet.user.screen_name + ': ' + tweet.text);
            }
        }
    }

    function onNotification(notification) {
        var message = notification.broadcastMessage;

        if (notification.rateChangeUserId != userId) {
            $('input[type=radio][name=maxTweetRate]').prop('checked', false).parent().removeClass('active');
            $('input[type=radio][name=maxTweetRate][value="' + notification.newMaxRate + '"]').prop('checked', true).parent().addClass('active');
            toastr.info(message);
        }
        else {
            toastr.success(message);
        }
    }

    function updateBarChart(countryIndex) {
        var bar = countryTweetsBarChart.datasets[0].bars[countryIndex];
        bar.value++;

        if (bar.value > (barChartSteps * barChartStepWidth)) { // we've gone off the chart - recalibrate and redraw

            // NB. the following clearup is required to prevent rendering issues but may cause individual clients to display different results due to redraw time etc
            isBarChartBeingRecalibrated = true;
            countryTweetsBarChart.destroy();
            $('#countryTweetsBarChart').remove();
            $('#countryTweetsBarChartContainer').append('<canvas id="countryTweetsBarChart" width="600" height="300"></canvas>');

            // redraw bar chart from scratch
            var canvas = $('#countryTweetsBarChart').get(0);
            var context = canvas.getContext('2d');

            $('#countryTweetsBarChart').fadeOut(function () {
                setBarChartData(getCountryNames(), getCountryTweetTotals());
                barChartStepWidth = barChartStepWidth * 2;
                setBarChartOptions(barChartSteps, barChartStepWidth, barChartStartValue);
                renderBarChart();
                $('#countryTweetsBarChart').fadeIn();
                isBarChartBeingRecalibrated = false;
            });

        } else {
            countryTweetsBarChart.update(); // no recalibration required, just update
        }
    }

    function updatePieChart(countryIndex) {
        var segment = countryTweetsPieChart.segments[countryIndex];
        segment.value++;
        countryTweetsPieChart.update();
    }

    // helpers
    function getCountryCodes() {
        var countryCodes = [];
        for (var i = 0, j = countries.length; i < j; i++) {
            countryCodes.push(countries[i].code);
        }
        return countryCodes;
    }

    function getCountryNames() {
        var countryNames = [];
        for (var i = 0, j = countries.length; i < j; i++) {
            countryNames.push(countries[i].name);
        }
        return countryNames;
    }

    function getCountryTweetTotals() {
        var countryTotals= [];
        for (var i = 0, j = countries.length; i < j; i++) {
            countryTotals.push(countries[i].tweets);
        }
        return countryTotals;
    }

    function extractTweet(tidiedTweet) {
        return {
            text: tidiedTweet.text,
            source: tidiedTweet.source,
            user: {
                id_str: tidiedTweet.user_id_str,
                screen_name: tidiedTweet.user_screen_name,
                profile_image_url: tidiedTweet.user_profile_image_url,
                geo_enabled: tidiedTweet.user_geo_enabled
            },
            place: {
                country_code: tidiedTweet.place_country_code,
                full_name: tidiedTweet.place_full_name
            },
            favorited: tidiedTweet.favorited,
            retweeted: tidiedTweet.retweeted,
            possibly_sensitive: tidiedTweet.possibly_sensitive,
            filter_level: tidiedTweet.filter_level
        }
    }

    function generateRandomRgbaCode() {
        return 'rgba(' + Math.floor(Math.random() * 255) + ',' + Math.floor(Math.random() * 255) + ',' + Math.floor(Math.random() * 255) + ',0.5)';
    }

    function generateGuid() {
        function s4() {
            return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
        }

        return (s4() + s4() + "-" + s4() + "-4" + s4().substr(0, 3) + "-" + s4() + "-" + s4() + s4() + s4()).toLowerCase();
    }
});