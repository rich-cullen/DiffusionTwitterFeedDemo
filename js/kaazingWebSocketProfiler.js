/****************************************************************
 *   KAAZING WebSocket Profiler
 ****************************************************************/
// TODO: wrapped websocket should be created internally, need to extend the pattern and intercept JmsConnectionFactory.createConnection more intelligently
// TODO: capture upstream traffic also - easiest way to do this?
// TODO: handle connectivity breaks
// TODO: tighten defensive coding in compatibility check stub implementation, initialisation, setters and Array maths helper
// TODO: Optional-  summary throughput stats to bits not bytes
// TODO: Optional - add convenience method to tidy up UI if app wants profiler to clear its own UI elements up
// TODO: Optional - add latency probe like in FX demo http://demo.kaazing.com/forex/ - NB. This might require a gateway echo service etc
// TODO: Optional - This could be a standalone widget and render its own UI buttons - would we want to include bootstrap in that case?
// TODO: Optional - draw tables using DOM API rather than jQuery
// TODO: When finished - document config, usage and dependencies

/****************************************************************
 *   console object stub for IE8 with no dev tools open etc
 ****************************************************************/
if(typeof console === 'undefined') {
    console = { log: function() { } };
}


/****************************************************************
 *   create webSocketProfiler module within Kaazing namespace
 ****************************************************************/
Kaazing = window.Kaazing || {};

Kaazing.webSocketProfiler = (function () {

    /****************************************************************
     *   compatibility check
     ****************************************************************/
    var isCompatible =  !!(window.$ && window.WebSocketFactory && Array.prototype.reduce),
        isBootstrapPresent = (typeof $().modal == 'function'); // will be used for styling tables if present

    // if incompatible return stub to prevent any subsequent application calls from throwing exceptions
    if (!isCompatible) {
        console.log('KAAZING WebSocket Profiler: Error! Unable to initialise due to missing dependencies.  Requires jQuery, Kaazing client library and ES5');

        var stub = function () { console.log('KAAZING WebSocket Profiler: Error! Unsupported method call') };
        return {
            initialise: stub,
            setProfileIntervalMilliseconds: stub,
            setIntervalSummaryTableContainerID: stub,
            setIntervalStatsHandler: stub,
            setResultsTableContainerID: stub,
            setResultsHandler: stub,
            start: stub,
            stop: stub
            //webSocketFactory: new WebSocketFactory() // TODO: obviously this ain't going to work if there's no WebSocketFactory!
        };
    }


    /****************************************************************
     *   Array maths helper
     ****************************************************************/
    var arrayMathUtility = {
        min: function (array) {
            var result = Math.min.apply( Math, array );
            return isFinite(result) ? result : 0;
        },
        max: function (array) {
            var result = Math.max.apply( Math, array );
            return isFinite(result) ? result : 0;
        },
        median: function (array) {
            var result,
                midpoint;

            array.sort( function(a,b) {return a - b;} );
            midpoint = Math.floor(array.length / 2);

            if (array.length % 2) {
                result = array[midpoint];
            } else {
                result = (array[midpoint-1] + array[midpoint]) / 2.0;
            }

            return isFinite(result) ? result : 0;
        },
        sum: function (array) {
            var result;

            if (array.length) {
                result = array.reduce(function (a, b) {
                    return a + b;
                });
            } else {
                result = 0;
            }

            return isFinite(result) ? result : 0;
        }
    };

    var formatUtility = {
        formatBytesHumanReadable: function (bytes) {
            var unitSize = 1000,
                units,
                unit,
                result = bytes;

            if (result < unitSize) {
                return result + ' (B)';
            }

            units = [ 'kB', 'MB', 'GB', 'TB', 'PB' ];
            unit = -1;
            do {
                result /= unitSize;
                unit++;
            } while (result >= unitSize);

            return Math.round(100 * result) / 100 + ' ' + units[unit]; // round to 2 decimal places
        }
    };


    /****************************************************************
     *   private variables
     ****************************************************************/
    var webSocketFactory,
        webSocket,
        profileStartTime,
        profileIntervalMilliseconds,
        profileIntervalID,
        intervalPackets = [],
        cumulativePackets = 0,
        cumulativeBytes = 0,
        intervalSummaryTableContainerIDSelector,
        intervalSummaryHandler = null,
        resultsTableContainerIDSelector,
        resultsHandler = null,
        includeControlPackets = true,
        enableLatencyProbe = false,
        debug,
        isInitialised = false,
        bandwidthHistorySize,
        downstreamBandwidthHistory = [];


    /****************************************************************
     *   private methods
     ****************************************************************/
    var initialise = function (config) {
            debug = config.debug || false;
            if (debug) { console.log('KAAZING WebSocket Profiler: initialising'); }
            profileIntervalMilliseconds = config.profileIntervalMilliseconds || 2000;
            if (config.intervalSummaryTableContainerID) { intervalSummaryTableContainerIDSelector = '#' + config.intervalSummaryTableContainerID; }
            intervalSummaryHandler = config.intervalSummaryHandler;
            if (config.resultsTableContainerID) { resultsTableContainerIDSelector = '#' + config.resultsTableContainerID; }
            resultsHandler = config.resultsHandler;
            includeControlPackets = config.includeControlPackets || true;
            bandwidthHistorySize = config.bandwidthHistorySize || 0;
            enableLatencyProbe = config.enableLatencyProbe || false;
            isInitialised = true;
        },

        interceptWebSocketCreation = function (wsFactory, intercept) {
            var superCreate = WebSocketFactory.prototype.createWebSocket;

            wsFactory.__proto__.createWebSocket = (function () {
                return function (location, protocols) {
                    var webSocket = superCreate.call(wsFactory, location, protocols);
                    intercept(webSocket);
                    return webSocket;
                }
            })();
        },

        webSocketMessageEventListener = function (event) {
            var messageBytes = event.data.limit; // event.data is a Kaazing ByteBuffer
            if (includeControlPackets || messageBytes > 20) {
                cumulativePackets++;
                cumulativeBytes = cumulativeBytes + messageBytes;
                intervalPackets.push({
                    bytes: (messageBytes)
                });
            }
        },

        generateIntervalStats = function () {

            var sizes = intervalPackets.map(function (d) {
                return d.bytes
            });

            var packetsPerSecond = Math.round(1000 * intervalPackets.length / profileIntervalMilliseconds);
            var totalBytes = arrayMathUtility.sum(sizes);
            var kilobytesPerSecond = Math.round(100 * totalBytes / profileIntervalMilliseconds) / 100; // rounded to 2 decimal points

            if (bandwidthHistorySize) {
                if (downstreamBandwidthHistory.length >= bandwidthHistorySize) {
                    downstreamBandwidthHistory.shift();
                }

                downstreamBandwidthHistory.push({
                    timeSinceStartMilliseconds: Math.floor(Date.now() - profileStartTime),
                    intervalKilobytesPerSecond: kilobytesPerSecond,
                    cumulativeKilobytes: Math.round(100 * cumulativeBytes / 1000) / 100 // rounded to 2 decimal points
                });
            }

            var intervalStats = {
                downstream: {
                    intervalPackets: (intervalPackets.length),
                    intervalBytes: (totalBytes),
                    intervalMinPacketSizeBytes: arrayMathUtility.min(sizes),
                    intervalMaxPacketSizeBytes: arrayMathUtility.max(sizes),
                    intervalMedianPacketSizeBytes: Math.floor(arrayMathUtility.median(sizes)),
                    intervalMilliseconds: (profileIntervalMilliseconds),
                    intervalPacketsPerSecond: (packetsPerSecond),
                    intervalKilobytesPerSecond: (kilobytesPerSecond),
                    bandWidthHistory: (downstreamBandwidthHistory),
                    cumulativePackets: (cumulativePackets),
                    cumulativeBytes: (cumulativeBytes)
                },
                upstream: {
                    //intervalPackets: 'TODO',
                    //intervalBytes: 'TODO',
                    //intervalMinPacketSizeBytes: 'TODO',
                    //intervalMaxPacketSizeBytes: 'TODO',
                    //intervalMedianPacketSizeBytes: 'TODO',
                    //intervalMilliseconds: 'TODO',
                    //intervalPacketsPerSecond: 'TODO',
                    //intervalKilobytesPerSecond: 'TODO',
                    //bandWidthHistory: 'TODO',
                    //cumulativePackets: 'TODO',
                    //cumulativeBytes: 'TODO'
                }
            };

            // reset collated packets for next interval
            intervalPackets = [];

            return intervalStats;
        },

        buildIntervalSummaryTable = function () {

            var $container = $(intervalSummaryTableContainerIDSelector),
                $table,
                $caption,
                $thead,
                $tbody,
                $tr,
                generateEmptyIntervalSummaryRow;

            if (!$container.find('table').length) {
                $table = $('<table>').attr('id', 'kwpIntervalSummaryTable');
                if (isBootstrapPresent) {
                    $table.addClass('table table-striped');
                }
                $caption = $('<caption>').text('Network Profiler Session & Interval Summary');
                $thead = $('<thead>');
                $tbody = $('<tbody>');

                $tr = $('<tr>');
                $tr.append($('<th>').text('Flow'));
                $tr.append($('<th>').text('Tot Packets'));
                $tr.append($('<th>').text('Tot Size'));
                $tr.append($('<th>').text('Avg Rate'));
                $tr.append($('<th>').text('Min Size (B)'));
                $tr.append($('<th>').text('Max Size (B)'));
                $tr.append($('<th>').text('Median Size (B)'));
                $tr.append($('<th>').text('Bandwidth'));
                $thead.append($tr);

                generateEmptyIntervalSummaryRow = function (flowDirection) {
                    $tr = $('<tr>');
                    $tr.append($('<td>').text(flowDirection + 'stream'));
                    $tr.append($('<td>').attr('id', 'kwpIntSum' + flowDirection + 'TotPackets'));
                    $tr.append($('<td>').attr('id', 'kwpIntSum' + flowDirection + 'TotBytes'));
                    $tr.append($('<td>').attr('id', 'kwpIntSum' + flowDirection + 'PacketsPerSecond'));
                    $tr.append($('<td>').attr('id', 'kwpIntSum' + flowDirection + 'MinPacketSize'));
                    $tr.append($('<td>').attr('id', 'kwpIntSum' + flowDirection + 'MaxPacketSize'));
                    $tr.append($('<td>').attr('id', 'kwpIntSum' + flowDirection + 'MedianPacketSize'));
                    $tr.append($('<td>').attr('id', 'kwpIntSum' + flowDirection + 'KilobytesPerSecond'));
                    return $tr
                };

                $tbody.append(generateEmptyIntervalSummaryRow('Down'));
                $tbody.append(generateEmptyIntervalSummaryRow('Up'));

                $table.append($caption);
                $table.append($thead);
                $table.append($tbody);
                $container.append($table);
            }
        },

        updateIntervalSummaryTable = function (intervalStats) {
            $('#kwpIntSumDownTotPackets').text(intervalStats.downstream.cumulativePackets);
            $('#kwpIntSumDownTotBytes').text(formatUtility.formatBytesHumanReadable(intervalStats.downstream.cumulativeBytes));
            $('#kwpIntSumDownPacketsPerSecond').text(intervalStats.downstream.intervalPacketsPerSecond + ' msg/s');
            $('#kwpIntSumDownMinPacketSize').text(intervalStats.downstream.intervalMinPacketSizeBytes);
            $('#kwpIntSumDownMaxPacketSize').text(intervalStats.downstream.intervalMaxPacketSizeBytes);
            $('#kwpIntSumDownMedianPacketSize').text(intervalStats.downstream.intervalMedianPacketSizeBytes);
            $('#kwpIntSumDownKilobytesPerSecond').text(intervalStats.downstream.intervalKilobytesPerSecond + ' kB/s');

            //$('#kwpIntSumUpTotPackets').text(intervalStats.upstream.cumulativePackets);
            //$('#kwpIntSumUpTotBytes').text(formatUtility.formatBytesHumanReadable(intervalStats.upstream.cumulativeBytes));
            //$('#kwpIntSumUpPacketsPerSecond').text(intervalStats.upstream.intervalPacketsPerSecond + ' msg/s');
            //$('#kwpIntSumUpMinPacketSize').text(intervalStats.upstream.intervalMinPacketSizeBytes);
            //$('#kwpIntSumUpMaxPacketSize').text(intervalStats.upstream.intervalMaxPacketSizeBytes);
            //$('#kwpIntSumUpMedianPacketSize').text(intervalStats.upstream.intervalMedianPacketSizeBytes);
            //$('#kwpIntSumUpKilobytesPerSecond').text(intervalStats.upstream.intervalKilobytesPerSecond + ' kB/s');
        },

        emitIntervalStats = function (intervalStats) {

            // call any interval stats handler registered by the application
            intervalSummaryHandler && intervalSummaryHandler(intervalStats);

            // update any table summary registered by the application
            if (intervalSummaryTableContainerIDSelector) {
                buildIntervalSummaryTable();
                updateIntervalSummaryTable(intervalStats);
            }
        },

        profile = function () {
            emitIntervalStats(generateIntervalStats());
        },

        generateResults = function (profileSessionDurationMilliseconds) {
            var profileDurationWholeSeconds = Math.floor(profileSessionDurationMilliseconds / 1000),
                factorHour = 3600 / profileDurationWholeSeconds,
                factorDay = 86400 / profileDurationWholeSeconds;

            return  {
                profileSessionDurationSeconds: profileDurationWholeSeconds,
                packetsProfileSession: cumulativePackets,
                packetsPerHour: Math.floor(cumulativePackets * factorHour),
                packetsPerDay: Math.floor(cumulativePackets * factorDay),
                bytesProfileSession: cumulativeBytes,
                bytesPerHour: cumulativeBytes * factorHour,
                bytesPerDay: cumulativeBytes * factorDay
            }
        },

        buildResultsTable = function () {
            var $container = $(resultsTableContainerIDSelector);

            // only build table if it's not already there
            if (!$container.find('table').length) {
                var $table,
                    $caption,
                    $thead,
                    $tbody,
                    $tr,
                    generateEmptyResultsRow = function (userCount) {
                        $tr = $('<tr>');
                        $tr.append($('<td>').text(userCount));
                        $tr.append($('<td>').attr('id', 'kwpResultsDown' + userCount + 'UserProfileSessionMegabytes'));
                        $tr.append($('<td>').attr('id', 'kwpResultsDown' + userCount + 'UserHourMegabytes'));
                        $tr.append($('<td>').attr('id', 'kwpResultsDown' + userCount + 'UserDayMegabytes'));
                        return $tr;
                    };

                $table = $('<table>').attr('id', 'kwpResultsTable');
                if (isBootstrapPresent) {
                    $table.addClass('table table-striped');
                }
                $caption = $('<caption>').text('KAAZING Gateway Downstream Network Utilisation Projection');
                $thead = $('<thead>');
                $tbody = $('<tbody>');

                $tr = $('<tr>');
                $tr.append($('<th>').text('Clients'));
                $tr.append($('<th>').attr('id', 'kwpResultsDownPerSessionHeader').text('Per Session'));
                $tr.append($('<th>').text('Per Hour'));
                $tr.append($('<th>').text('Per Day'));
                $thead.append($tr);

                $tbody.append(generateEmptyResultsRow(1));
                $tbody.append(generateEmptyResultsRow(200));
                $tbody.append(generateEmptyResultsRow(500));
                $tbody.append(generateEmptyResultsRow(1000));
                $tbody.append(generateEmptyResultsRow(10000));

                $table.append($caption);
                $table.append($thead);
                $table.append($tbody);
                $container.append($table);
            }
        },

        updateResultsTable = function (results) {
            var populateResultsRow = function (userCount) {
                $('#kwpResultsDown' + userCount + 'UserProfileSessionMegabytes').text(formatUtility.formatBytesHumanReadable(results.bytesProfileSession * userCount));
                $('#kwpResultsDown' + userCount + 'UserHourMegabytes').text(formatUtility.formatBytesHumanReadable(results.bytesPerHour * userCount));
                $('#kwpResultsDown' + userCount + 'UserDayMegabytes').text(formatUtility.formatBytesHumanReadable(results.bytesPerDay * userCount));
            };

            $('#kwpResultsDownPerSessionHeader').text('Per Session (' + results.profileSessionDurationSeconds + ' seconds)');
            populateResultsRow(1);
            populateResultsRow(200);
            populateResultsRow(500);
            populateResultsRow(1000);
            populateResultsRow(10000);
            $(resultsTableContainerIDSelector).children().fadeIn(1000);
        },

        emitResults = function (results) {

            // call any results handler registered by the application
            resultsHandler && resultsHandler(results);

            // update any table summary registered by the application
            if (resultsTableContainerIDSelector) {
                buildResultsTable();
                updateResultsTable(results);
            }
        },

        setProfileIntervalMilliseconds = function (value) {
            profileIntervalMilliseconds = value;
            if (profileIntervalID) { clearInterval(profileIntervalID); }
            profileIntervalID = setInterval(profile, profileIntervalMilliseconds);
        },

        setIntervalSummaryTableContainerID = function (value) {
            intervalSummaryTableContainerIDSelector = '#' + value;
        },

        setIntervalStatsHandler = function (value) {
            intervalSummaryHandler = value;
        },

        setResultsTableContainerID = function (value) {
            resultsTableContainerIDSelector = '#' + value;
        },

        setResultsHandler = function (value) {
            resultsHandler = value;
        },

        start = function () {
            webSocket = webSocketFactory.wrappedWebSocket; // NB. relies app already setting this as the JmsConnectionFactory's WebSocketFactory, and then calling start() AFTER connection is established
            if (!isInitialised) {
                console.log('KAAZING WebSocket Profiler: Error! Profiler has not been initialised. Call initialise() before starting.');
                return -1;
            } else if (!webSocket) {
                console.log('KAAZING WebSocket Profiler: Error! Unable to start - no WebSocket connection available');
                return -2;
            } else {

                // remove results from any previous profiling session
                if (resultsTableContainerIDSelector) {
                    $(resultsTableContainerIDSelector).children().fadeOut();
                }

                profileStartTime = Date.now();
                cumulativePackets = 0;
                cumulativeBytes = 0;
                intervalPackets = [];
                webSocket.addEventListener('message', webSocketMessageEventListener, false);
                profile();
                profileIntervalID = setInterval(profile, profileIntervalMilliseconds);
                if (debug) { console.log('KAAZING WebSocket Profiler: profiling started'); }
                return 0;
            }
        },

        stop = function () {
            if (webSocket) { webSocket.removeEventListener('message', webSocketMessageEventListener, false); }
            if (profileIntervalID) { clearInterval(profileIntervalID); }
            emitResults(generateResults(Date.now() - profileStartTime));
            if (debug) { console.log('KAAZING WebSocket Profiler: profiling stopped'); }
        };


    /****************************************************************
     *   intercept WebSocket creation so we can attach listeners
     ****************************************************************/
    webSocketFactory = new WebSocketFactory();
    interceptWebSocketCreation(webSocketFactory, function (ws) {
        webSocketFactory.wrappedWebSocket = ws;
    });


    /****************************************************************
     *   public interface
     ****************************************************************/
    return {
        initialise: initialise,
        setProfileIntervalMilliseconds: setProfileIntervalMilliseconds,
        setIntervalSummaryTableContainerID: setIntervalSummaryTableContainerID,
        setIntervalStatsHandler: setIntervalStatsHandler,
        setResultsTableContainerID: setResultsTableContainerID,
        setResultsHandler: setResultsHandler,
        start: start,
        stop: stop,
        webSocketFactory: webSocketFactory
    };
}());