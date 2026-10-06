const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3004;

// Enable CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Cache for SEPA data (refresh every 6 hours)
const CACHE_VERSION = 2; // Increment this when changing parsing logic
let riverCache = { data: null, timestamp: 0, version: 0 };
let stationCache = { data: null, timestamp: 0, version: 0 };
let catchmentCache = { data: null, timestamp: 0, version: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Anthropic API configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
}

// Load Scotland rivers guide data (from UK Rivers Guidebook)
let riverGuideData = [];
try {
    const guideFile = path.join(__dirname, 'scotland_rivers_detail.json');
    riverGuideData = JSON.parse(fs.readFileSync(guideFile, 'utf-8'));
    console.log(`📖 Loaded ${riverGuideData.length} river guide entries`);
} catch (err) {
    console.error('Warning: Could not load scotland_rivers_detail.json:', err.message);
}

// Lookup river guide info by name (fuzzy match)
function lookupRiverGuide(riverName) {
    const search = riverName.toLowerCase().replace(/^(river|the)\s+/i, '').trim();

    const matches = riverGuideData.filter(r => {
        const name = (r.page_name || r.name_of_river || '').toLowerCase();
        return name.includes(search) || search.includes(name.replace(/river\s+/i, '').split(' - ')[0].trim());
    });

    if (matches.length === 0) return { found: false, river_name: riverName, message: 'No guide entry found for this river.' };

    return {
        found: true,
        count: matches.length,
        sections: matches.map(r => ({
            name: r.page_name,
            river: r.name_of_river,
            region: r.region,
            grading: r.grading,
            water_level_notes: r.water_level,
            general_description: r.general_description,
            major_hazards: r.major_hazards,
            put_in_take_out: r.where_is_it,
            approx_length: r.approx_length,
            time_needed: r.time_needed,
            access_hassles: r.access_hassles,
            other_notes: r.other_notes,
            sepa_station: r.sepa_station || null
        }))
    };
}

// Helper: Make HTTPS request
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(new Error('Failed to parse JSON response'));
                }
            });
        }).on('error', reject);
    });
}

// Helper: Make Anthropic API request
function callAnthropicAPI(payload) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(payload);
        
        const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, data: JSON.parse(responseBody) });
                } catch (err) {
                    reject(new Error('Failed to parse Anthropic response'));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// Helper: Convert SEPA array format to objects
function parseSepaArrayData(arrayData) {
    if (!Array.isArray(arrayData) || arrayData.length < 2) return [];
    
    const headers = arrayData[0]; // First row is headers
    const rows = arrayData.slice(1); // Rest are data
    
    return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index];
        });
        return obj;
    }).filter(obj => obj.river_id !== "0"); // Filter out "---" entries
}

// MCP Tool: Get river list
async function getRivers() {
    const now = Date.now();
    
    if (riverCache.data && 
        riverCache.version === CACHE_VERSION && 
        (now - riverCache.timestamp) < CACHE_TTL) {
        console.log('Returning cached river list');
        return riverCache.data;
    }
    
    console.log('Fetching fresh river list from SEPA...');
    const url = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&request=getRiverList&datasource=0&format=json';
    
    try {
        const rawData = await httpsGet(url);
        const data = parseSepaArrayData(rawData);
        riverCache = { data, timestamp: now, version: CACHE_VERSION };
        console.log(`Parsed ${data.length} rivers from SEPA`);
        return data;
    } catch (err) {
        console.error('Error fetching rivers:', err);
        throw err;
    }
}

// MCP Tool: Get all stations (with optional river filter)
async function getStations(riverName = null) {
    const now = Date.now();
    
    // Get all stations (cached)
    let stations;
    if (stationCache.data && 
        stationCache.version === CACHE_VERSION && 
        (now - stationCache.timestamp) < CACHE_TTL) {
        console.log('Using cached station list');
        stations = stationCache.data;
    } else {
        console.log('Fetching fresh station list from SEPA...');
        const url = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&request=getstationlist&returnfields=station_no,station_name,river_name&format=json';
        const rawData = await httpsGet(url);
        stations = parseSepaArrayData(rawData);
        stationCache = { data: stations, timestamp: now, version: CACHE_VERSION };
        console.log(`Parsed ${stations.length} stations from SEPA`);
    }
    
    // Filter by river name if provided
    if (riverName) {
        const filtered = stations.filter(s => 
            s.river_name && s.river_name.toLowerCase().includes(riverName.toLowerCase())
        );
        console.log(`Found ${filtered.length} stations for river: ${riverName}`);
        
        // Further filter to only include stations with Level data
        const withLevels = [];
        for (const station of filtered) {
            try {
                const timeSeries = await getStationTimeSeries(station.station_no);
                const hasLevelData = timeSeries.some(ts => 
                    ts.ts_name && ts.ts_name.includes('15minute') && !ts.ts_name.includes('Rising')
                );
                if (hasLevelData) {
                    withLevels.push(station);
                }
            } catch (err) {
                // Station doesn't have accessible data, skip it
                continue;
            }
        }
        console.log(`${withLevels.length} of those stations have level monitoring`);
        return withLevels;
    }
    
    return stations;
}

// MCP Tool: Get catchment list (cached)
async function getCatchments() {
    const now = Date.now();

    if (catchmentCache.data &&
        catchmentCache.version === CACHE_VERSION &&
        (now - catchmentCache.timestamp) < CACHE_TTL) {
        return catchmentCache.data;
    }

    console.log('Fetching catchment list from SEPA...');
    const url = 'https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&request=getCatchmentList&datasource=0&format=json';
    const rawData = await httpsGet(url);
    const data = parseSepaArrayData(rawData).filter(c => c.catchment_name !== '---' && c.catchment_name !== '0');
    catchmentCache = { data, timestamp: now, version: CACHE_VERSION };
    console.log(`Parsed ${data.length} catchments from SEPA`);
    return data;
}

// MCP Tool: Get all stations in a catchment
async function getCatchmentStations(catchmentName) {
    // First find the catchment
    const catchments = await getCatchments();
    const searchTerm = catchmentName.toLowerCase();
    const matchedCatchment = catchments.find(c =>
        c.catchment_name.toLowerCase().includes(searchTerm)
    );

    if (!matchedCatchment) {
        // Return a few close matches instead of the entire list
        const suggestions = catchments
            .map(c => c.catchment_name)
            .filter(n => n.toLowerCase().includes(searchTerm.charAt(0)))
            .sort()
            .slice(0, 15);
        return { found: false, catchment_name: catchmentName, message: 'No matching catchment found.', suggestions };
    }

    console.log(`Found catchment: ${matchedCatchment.catchment_name} (no: ${matchedCatchment.catchment_no})`);

    // Fetch stations in this catchment
    const url = `https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&request=getStationList&datasource=0&format=json&catchment_no=${matchedCatchment.catchment_no}&returnfields=station_no,station_name,river_name,catchment_name`;
    const rawData = await httpsGet(url);
    const stations = parseSepaArrayData(rawData);

    console.log(`Found ${stations.length} stations in catchment ${matchedCatchment.catchment_name}`);

    return {
        found: true,
        catchment: matchedCatchment.catchment_name,
        catchment_no: matchedCatchment.catchment_no,
        stations: stations,
        count: stations.length
    };
}

// Fetch SEPA level bands (low/normal/high thresholds) for a station
let bandsCache = {};
async function getStationBands(stationNo) {
    if (bandsCache[stationNo]) return bandsCache[stationNo];

    const url = `https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&request=getStationList&station_no=${stationNo}&returnfields=station_name,station_no,ca_sta&ca_sta_returnfields=sepa_median_annual_minimum_level,sepa_median_annual_maximum_level&format=objson`;
    try {
        const data = await httpsGet(url);
        const station = Array.isArray(data) ? data[0] : data;
        const minLevel = parseFloat(station.sepa_median_annual_minimum_level);
        const maxLevel = parseFloat(station.sepa_median_annual_maximum_level);

        if (isNaN(minLevel) || isNaN(maxLevel)) {
            bandsCache[stationNo] = null;
            return null;
        }

        const bands = {
            low: { min: 0, max: minLevel, label: 'Low' },
            normal: { min: minLevel, max: maxLevel, label: 'Normal' },
            high: { min: maxLevel, max: maxLevel + (maxLevel - minLevel) * 0.6, label: 'High' }
        };
        bandsCache[stationNo] = bands;
        return bands;
    } catch (err) {
        console.error(`Error fetching bands for station ${stationNo}:`, err);
        bandsCache[stationNo] = null;
        return null;
    }
}

// Classify a level reading against the bands
function classifyLevel(level, bands) {
    if (!bands || level == null) return 'Unknown';
    if (level <= bands.low.max) return 'Low';
    if (level <= bands.normal.max) return 'Normal';
    return 'High';
}

// MCP Tool: Get level graph — returns a marker for the frontend to render
async function getLevelGraph(stationNo, stationName, period = 'P2D') {
    // Verify the station has level data
    const timeSeries = await getStationTimeSeries(stationNo);
    const levelSeries = timeSeries.find(ts => ts.ts_name && ts.ts_name.includes('15minute') && !ts.ts_name.includes('Rising'));

    if (!levelSeries) {
        throw new Error(`No 15minute level data found for station ${stationNo}`);
    }

    return {
        station_no: stationNo,
        station_name: stationName || `Station ${stationNo}`,
        period: period,
        embed: `[LEVEL_GRAPH:${stationNo}:${period}:${stationName || 'Station ' + stationNo}]`
    };
}

// MCP Tool: Get time series IDs for a station
async function getStationTimeSeries(stationNo) {
    console.log(`Fetching time series for station ${stationNo}...`);
    const url = `https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&request=gettimeserieslist&station_no=${stationNo}&stationparameter_name=Level&format=json`;
    
    try {
        const rawData = await httpsGet(url);
        const data = parseSepaArrayData(rawData);
        console.log(`Found ${data.length} time series for station ${stationNo}`);
        return data;
    } catch (err) {
        console.error('Error fetching time series:', err);
        throw err;
    }
}

// MCP Tool: Get level data for last 24 hours
async function getStationLevels(stationNo) {
    console.log(`Getting current levels for station ${stationNo}...`);
    
    // First get the time series IDs
    const timeSeries = await getStationTimeSeries(stationNo);
    
    // Find the 15minute and RisingFalling series
    const levelSeries = timeSeries.find(ts => ts.ts_name && ts.ts_name.includes('15minute') && !ts.ts_name.includes('Rising'));
    const trendSeries = timeSeries.find(ts => ts.ts_name && ts.ts_name.includes('RisingFalling'));
    
    if (!levelSeries) {
        throw new Error(`No 15minute level data found for station ${stationNo}`);
    }
    
    // Fetch level data
    const levelUrl = `https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&request=getTimeseriesValues&ts_id=${levelSeries.ts_id}&format=json&period=P1D`;
    const levelData = await httpsGet(levelUrl);
    
    // Fetch trend data if available
    let trendData = null;
    if (trendSeries) {
        const trendUrl = `https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&request=getTimeseriesValues&ts_id=${trendSeries.ts_id}&format=json&period=P1D`;
        trendData = await httpsGet(trendUrl);
    }
    
    // Get latest values
    const latestLevel = levelData.length > 0 ? levelData[levelData.length - 1] : null;
    const latestTrend = trendData && trendData.length > 0 ? trendData[trendData.length - 1] : null;

    // Summarise 24h data instead of sending all ~96 data points
    const levels = levelData.filter(d => d && d[1] != null).map(d => parseFloat(d[1]));
    const summary_24h = levels.length > 0 ? {
        min: Math.min(...levels).toFixed(3),
        max: Math.max(...levels).toFixed(3),
        mean: (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(3),
        data_points: levels.length,
        oldest_reading: levelData[0],
        newest_reading: levelData[levelData.length - 1]
    } : null;

    // Fetch level bands and classify current reading
    const bands = await getStationBands(stationNo);
    const currentValue = latestLevel && latestLevel[1] != null ? parseFloat(latestLevel[1]) : null;
    const classification = classifyLevel(currentValue, bands);

    return {
        station_no: stationNo,
        current_level: latestLevel,
        trend: latestTrend,
        classification,
        bands: bands ? { low_max: bands.low.max, normal_max: bands.normal.max } : null,
        summary_24h
    };
}

// Helper: Get approximate coordinates for a river area
function getRiverCoordinates(riverName) {
    // Approximate coordinates for common Scottish rivers (center of catchment)
    const riverCoords = {
        'leny': { lat: 56.28, lon: -4.30, area: 'Callander/Trossachs' },
        'findhorn': { lat: 57.50, lon: -3.60, area: 'Moray' },
        'tay': { lat: 56.50, lon: -4.00, area: 'Perthshire' },
        'spey': { lat: 57.20, lon: -3.40, area: 'Speyside' },
        'tummel': { lat: 56.70, lon: -4.00, area: 'Perthshire' },
        'garry': { lat: 56.82, lon: -4.20, area: 'Perthshire' },
        'orchy': { lat: 56.50, lon: -4.80, area: 'Argyll' },
        'etive': { lat: 56.55, lon: -5.00, area: 'Glencoe' },
        'roy': { lat: 56.90, lon: -4.70, area: 'Lochaber' },
        'spean': { lat: 56.90, lon: -4.85, area: 'Lochaber' },
        'nevis': { lat: 56.82, lon: -5.00, area: 'Fort William' },
        'nith': { lat: 55.25, lon: -3.60, area: 'Dumfries' },
        'tweed': { lat: 55.60, lon: -2.70, area: 'Borders' },
        'forth': { lat: 56.15, lon: -3.95, area: 'Stirling' },
        'teith': { lat: 56.20, lon: -4.15, area: 'Stirling' },
        'clyde': { lat: 55.65, lon: -3.80, area: 'Lanarkshire' }
    };
    
    const key = riverName.toLowerCase();
    return riverCoords[key] || { lat: 56.50, lon: -4.00, area: 'Central Scotland' }; // Default to central Scotland
}

// MCP Tool: Get weather forecast
async function getWeatherForecast(riverName) {
    console.log(`Getting weather forecast for ${riverName}...`);
    
    const coords = getRiverCoordinates(riverName);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,precipitation,wind_speed_10m&hourly=temperature_2m,precipitation,wind_speed_10m&forecast_days=2&timezone=Europe/London`;
    
    try {
        const data = await httpsGet(url);
        
        // Extract current conditions
        const current = {
            temperature: data.current.temperature_2m,
            precipitation: data.current.precipitation,
            wind_speed: data.current.wind_speed_10m,
            time: data.current.time
        };
        
        // Extract 24h forecast (next 24 hours)
        const now = new Date();
        const next24h = data.hourly.time.map((time, i) => ({
            time,
            temperature: data.hourly.temperature_2m[i],
            precipitation: data.hourly.precipitation[i],
            wind_speed: data.hourly.wind_speed_10m[i]
        })).slice(0, 24); // Next 24 hours
        
        // Calculate total rainfall in next 24h
        const total_rainfall_24h = next24h.reduce((sum, hour) => sum + hour.precipitation, 0);
        
        // Find rainy hours for a compact breakdown
        const rainyHours = next24h.filter(h => h.precipitation > 0).map(h => ({
            time: h.time,
            rain_mm: h.precipitation
        }));

        return {
            location: coords.area,
            river: riverName,
            current,
            summary: {
                total_rainfall_24h: `${total_rainfall_24h.toFixed(1)}mm`,
                max_wind_24h: `${Math.max(...next24h.map(h => h.wind_speed))}km/h`,
                temp_range_24h: `${Math.min(...next24h.map(h => h.temperature))}-${Math.max(...next24h.map(h => h.temperature))}°C`
            },
            rainy_hours: rainyHours
        };
    } catch (err) {
        console.error('Error fetching weather:', err);
        throw err;
    }
}

// Helper: Get approximate coordinates for a river area
function getRiverCoordinates(riverName) {
    // Approximate coordinates for common Scottish rivers (center of catchment)
    const riverCoords = {
        'leny': { lat: 56.28, lon: -4.30, area: 'Callander/Trossachs' },
        'findhorn': { lat: 57.50, lon: -3.60, area: 'Moray' },
        'tay': { lat: 56.50, lon: -4.00, area: 'Perthshire' },
        'spey': { lat: 57.20, lon: -3.40, area: 'Speyside' },
        'tummel': { lat: 56.70, lon: -4.00, area: 'Perthshire' },
        'garry': { lat: 56.82, lon: -4.20, area: 'Perthshire' },
        'orchy': { lat: 56.50, lon: -4.80, area: 'Argyll' },
        'etive': { lat: 56.55, lon: -5.00, area: 'Glencoe' },
        'roy': { lat: 56.90, lon: -4.70, area: 'Lochaber' },
        'spean': { lat: 56.90, lon: -4.85, area: 'Lochaber' },
        'nevis': { lat: 56.82, lon: -5.00, area: 'Fort William' },
        'nith': { lat: 55.25, lon: -3.60, area: 'Dumfries' },
        'tweed': { lat: 55.60, lon: -2.70, area: 'Borders' },
        'forth': { lat: 56.15, lon: -3.95, area: 'Stirling' },
        'teith': { lat: 56.20, lon: -4.15, area: 'Stirling' },
        'clyde': { lat: 55.65, lon: -3.80, area: 'Lanarkshire' }
    };
    
    const key = riverName.toLowerCase();
    return riverCoords[key] || { lat: 56.50, lon: -4.00, area: 'Central Scotland' }; // Default to central Scotland
}

// Define MCP tools for Claude
const MCP_TOOLS = [
    {
        name: "search_rivers",
        description: "Search for Scottish rivers in the SEPA database. Returns a list of rivers with their IDs. Use this when the user mentions a river name.",
        input_schema: {
            type: "object",
            properties: {
                river_name: {
                    type: "string",
                    description: "Name of the river to search for (e.g., 'Leny', 'Findhorn', 'Tay')"
                }
            },
            required: ["river_name"]
        }
    },
    {
        name: "get_river_stations",
        description: "Get all monitoring stations for a specific river. Returns station names, numbers, and locations. Use this after finding a river to see available monitoring points.",
        input_schema: {
            type: "object",
            properties: {
                river_name: {
                    type: "string",
                    description: "Name of the river to get stations for"
                }
            },
            required: ["river_name"]
        }
    },
    {
        name: "get_station_levels",
        description: "Get current water levels and 24-hour trend data for a specific monitoring station. Returns current level in meters, rising/falling status, and historical data. Use this to check paddling conditions.",
        input_schema: {
            type: "object",
            properties: {
                station_no: {
                    type: "string",
                    description: "Station number from SEPA (e.g., '14888')"
                }
            },
            required: ["station_no"]
        }
    },
    {
        name: "get_weather_forecast",
        description: "Get current weather and 24-hour forecast for a river area. Returns temperature, precipitation, and wind data. Use this to assess upcoming paddling conditions and recent rainfall that affects river levels.",
        input_schema: {
            type: "object",
            properties: {
                river_name: {
                    type: "string",
                    description: "Name of the river to get weather for (e.g., 'Leny', 'Findhorn')"
                }
            },
            required: ["river_name"]
        }
    },
    {
        name: "get_level_graph",
        description: "Get an interactive water level graph for a monitoring station. Returns an embed marker that the frontend will render as a chart. ALWAYS call this when discussing river levels, and include the 'embed' value from the result directly in your response text — the frontend will replace it with a rendered graph.",
        input_schema: {
            type: "object",
            properties: {
                station_no: {
                    type: "string",
                    description: "Station number from SEPA (e.g., '234178')"
                },
                station_name: {
                    type: "string",
                    description: "Human-readable station name (e.g., 'Camisky', 'Grandtully')"
                },
                period: {
                    type: "string",
                    description: "Time period in ISO 8601 duration format. Default: 'P2D' (2 days). Examples: 'P1D' (1 day), 'P7D' (1 week)."
                }
            },
            required: ["station_no"]
        }
    },
    {
        name: "get_catchment_stations",
        description: "Get all SEPA monitoring stations within a river catchment. Use this when a river has no direct SEPA stations — find the catchment it belongs to (e.g., River Spean is in the 'Lochy' catchment) and get all stations in that area. Returns station names, numbers, and associated river names. If the catchment name doesn't match, returns a list of all available catchment names to help you find the right one.",
        input_schema: {
            type: "object",
            properties: {
                catchment_name: {
                    type: "string",
                    description: "Name or partial name of the catchment (e.g., 'Lochy', 'Tay', 'Spey')"
                }
            },
            required: ["catchment_name"]
        }
    },
    {
        name: "search_stations",
        description: "Search for SEPA monitoring stations by station name. Use this when you need to find a specific monitoring station (e.g., 'Camisky', 'Grandtully') or when a river isn't directly monitored by SEPA but a nearby station on a related river covers its catchment. Returns station name, station number, and associated river name.",
        input_schema: {
            type: "object",
            properties: {
                station_name: {
                    type: "string",
                    description: "Name or partial name of the SEPA monitoring station to search for (e.g., 'Camisky', 'Grand*')"
                }
            },
            required: ["station_name"]
        }
    },
    {
        name: "get_river_guide",
        description: "Get detailed paddling guide information for a Scottish river from the UK Rivers Guidebook. Returns grading, water level guidance (what levels are needed, what's low/medium/high for THIS specific river), hazards, put-in/take-out locations, river description, and general notes. ALWAYS use this tool alongside SEPA level data to properly interpret whether current levels are good for paddling on a specific river.",
        input_schema: {
            type: "object",
            properties: {
                river_name: {
                    type: "string",
                    description: "Name of the river to look up (e.g., 'Leny', 'Findhorn', 'Orchy')"
                }
            },
            required: ["river_name"]
        }
    }
];

// Execute MCP tool
async function executeTool(toolName, toolInput) {
    console.log(`Executing tool: ${toolName}`, toolInput);
    
    try {
        switch (toolName) {
            case 'search_rivers': {
                const rivers = await getRivers();
                const searchTerm = toolInput.river_name.toLowerCase();
                const matches = rivers.filter(r => 
                    r.river_name && r.river_name.toLowerCase().includes(searchTerm)
                );
                return { rivers: matches, count: matches.length };
            }
            
            case 'get_river_stations': {
                const stations = await getStations(toolInput.river_name);
                return { stations, count: stations.length };
            }
            
            case 'get_station_levels': {
                const levels = await getStationLevels(toolInput.station_no);
                return levels;
            }
            
            case 'get_level_graph': {
                return await getLevelGraph(toolInput.station_no, toolInput.station_name, toolInput.period || 'P2D');
            }

            case 'get_catchment_stations': {
                return await getCatchmentStations(toolInput.catchment_name);
            }

            case 'search_stations': {
                const stations = await getStations();
                const searchTerm = toolInput.station_name.toLowerCase().replace(/\*$/, '');
                const matches = stations.filter(s =>
                    s.station_name && s.station_name.toLowerCase().includes(searchTerm)
                );
                return { stations: matches, count: matches.length };
            }

            case 'get_weather_forecast': {
                const weather = await getWeatherForecast(toolInput.river_name);
                return weather;
            }

            case 'get_river_guide': {
                return lookupRiverGuide(toolInput.river_name);
            }

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    } catch (err) {
        console.error(`Tool execution error:`, err);
        return { error: err.message };
    }
}

// Main chat endpoint with MCP
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, systemPrompt } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages array is required' });
        }
        
        console.log('River Guide chat request received...');
        
        // Initial call to Claude with tools
        let currentMessages = [...messages];
        let continueLoop = true;
        let iterationCount = 0;
        const MAX_ITERATIONS = 10;
        
        while (continueLoop && iterationCount < MAX_ITERATIONS) {
            iterationCount++;
            console.log(`\n--- Iteration ${iterationCount} ---`);
            
            // Call Anthropic with current messages
            const response = await callAnthropicAPI({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 4096,
                system: systemPrompt || 'You are a helpful assistant.',
                messages: currentMessages,
                tools: MCP_TOOLS
            });
            
            if (response.statusCode !== 200) {
                console.error('Anthropic API error:', response.statusCode);
                return res.status(response.statusCode).json(response.data);
            }
            
            const assistantMessage = response.data.content;
            console.log('Claude response content blocks:', assistantMessage.length);
            
            // Check if Claude wants to use tools
            const toolUseBlocks = assistantMessage.filter(block => block.type === 'tool_use');
            
            if (toolUseBlocks.length === 0) {
                // No tools needed, return final response
                console.log('No tools requested, returning final answer');
                return res.json(response.data);
            }
            
            console.log(`Claude requested ${toolUseBlocks.length} tool(s)`);
            
            // Add assistant message to conversation
            currentMessages.push({
                role: 'assistant',
                content: assistantMessage
            });
            
            // Execute each tool and collect results
            const toolResults = [];
            for (const toolBlock of toolUseBlocks) {
                console.log(`\nExecuting: ${toolBlock.name}`);
                const result = await executeTool(toolBlock.name, toolBlock.input);
                console.log(`Result:`, JSON.stringify(result).substring(0, 200) + '...');
                
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolBlock.id,
                    content: JSON.stringify(result)
                });
            }
            
            // Add tool results to conversation
            currentMessages.push({
                role: 'user',
                content: toolResults
            });
            
            // Continue loop to let Claude process tool results
        }
        
        if (iterationCount >= MAX_ITERATIONS) {
            console.error('Max iterations reached');
            return res.status(500).json({ error: 'Too many tool iterations' });
        }
        
    } catch (err) {
        console.error('Chat error:', err);
        res.status(500).json({ error: 'Internal server error', message: err.message });
    }
});

// Direct API: Level data for frontend graph rendering
app.get('/api/graph/:stationNo', async (req, res) => {
    try {
        const { stationNo } = req.params;
        const period = req.query.period || 'P2D';

        const timeSeries = await getStationTimeSeries(stationNo);
        const levelSeries = timeSeries.find(ts => ts.ts_name && ts.ts_name.includes('15minute') && !ts.ts_name.includes('Rising'));

        if (!levelSeries) {
            return res.status(404).json({ error: 'No level data found for this station' });
        }

        const url = `https://timeseries.sepa.org.uk/KiWIS/KiWIS?service=kisters&type=queryServices&datasource=0&request=getTimeseriesValues&ts_id=${levelSeries.ts_id}&format=json&period=${period}`;
        const rawData = await httpsGet(url);

        // rawData is [{ts_id, rows, columns, data: [[timestamp, value], ...]}, ...]
        const seriesData = (rawData && rawData[0] && rawData[0].data) ? rawData[0].data : [];
        const points = seriesData
            .filter(d => d && d[0] && d[1] != null)
            .map(d => ({ t: d[0], v: parseFloat(d[1]) }));

        // Fetch level bands for chart background
        const bands = await getStationBands(stationNo);

        res.json({ station_no: stationNo, period, points, bands: bands || null });
    } catch (err) {
        console.error('Graph data error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'mcp-sepa',
        tools: MCP_TOOLS.map(t => t.name),
        anthropicConfigured: !!ANTHROPIC_API_KEY
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 MCP SEPA Server running on port ${PORT}`);
    console.log(`📊 Available tools: ${MCP_TOOLS.map(t => t.name).join(', ')}`);
    console.log(`🔑 Anthropic API: ${ANTHROPIC_API_KEY ? 'Configured' : 'Missing'}`);
    console.log(`💾 Cache TTL: ${CACHE_TTL / (60 * 60 * 1000)} hours\n`);
});