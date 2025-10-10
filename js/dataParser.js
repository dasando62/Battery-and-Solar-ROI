// js/dataParser.js 
// Version 1.1.4
// This module is responsible for handling file uploads and parsing CSV data.
// It reads electricity usage and solar generation files, processes them into a
// standardized hourly format, and stores the results in the global state.

/*
 * Home Battery & Solar ROI Analyzer
 * Copyright (c) 2025 [DaSando62]
 *
 * This software is licensed under the MIT License.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { state } from './state.js';
import { displayError, parseDateString } from './utils.js';
import { toggleExistingSolar } from './uiEvents.js';
import { generateHourlySolarProfileFromDaily } from './profiles.js';

/**
 * Parses a NEM12 format CSV file and transforms it into the hourly format
 * required by the calculator. This version is corrected to only process
 * relevant grid import (E1) and grid export (B1) data streams.
 * @param {string} csvText - The raw text content of the NEM12 file.
 * @returns {Array<object>} An array of day objects in the application's internal format.
 */
function parseNEM12(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    const dailyData = new Map();

    // Use these variables to track the state as we parse through the file
    let currentIntervalLength = null;
    let currentDataType = null; // e.g., 'E1' for consumption, 'B1' for feed-in

    for (const line of lines) {
        // NEM12 files can be comma or tab-separated. Handle both.
        const parts = line.includes('\t') ? line.split('\t') : line.split(',');

        // Process a 200 record to understand the data that follows
        if (parts[0] === '200') {
            currentDataType = parts[4]; // The 'Suffix' field, e.g., E1, B1
            currentIntervalLength = parseInt(parts[8], 10);
            // We only care about grid import (E1) and grid export (B1).
            // Ignore other streams like gross generation, as that comes from the solar file.
            if (currentDataType !== 'E1' && currentDataType !== 'B1') {
                currentIntervalLength = null; // Invalidate to skip subsequent 300 records for this stream
            }
        }

        // Process a 300 record, but only if its stream is relevant (E1 or B1)
        if (parts[0] === '300' && currentIntervalLength) {
            const dateStr = parts[1]; // YYYYMMDD format
            if (dateStr.length !== 8) continue;
            
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            const date = `${year}-${month}-${day}`;

            const intervalsInHour = 60 / currentIntervalLength;
            const numIntervalsPerDay = 24 * intervalsInHour;
            const values = parts.slice(2, 2 + numIntervalsPerDay).map(v => parseFloat(v) || 0);

            // Ensure we have a data structure for this date
            if (!dailyData.has(date)) {
                dailyData.set(date, {
                    date: date,
                    consumption: Array(24).fill(0),
                    feedIn: Array(24).fill(0)
                });
            }
            const dayRecord = dailyData.get(date);

            // Aggregate interval data into 24 hourly buckets
            for (let hour = 0; hour < 24; hour++) {
                const startInterval = hour * intervalsInHour;
                const endInterval = startInterval + intervalsInHour;
                const hourSlice = values.slice(startInterval, endInterval);
                const hourTotal = hourSlice.reduce((sum, val) => sum + val, 0);

                // Assign the hourly total to the correct array based on the stream type
                if (currentDataType === 'E1') { // E1 = Grid Consumption (Import)
                    dayRecord.consumption[hour] += hourTotal;
                } else if (currentDataType === 'B1') { // B1 = Grid Feed-in (Export)
                    dayRecord.feedIn[hour] += hourTotal;
                }
            }
        }
    }
    // Return the data in the application's standard internal format
    return Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
}



/**
 * A generic CSV parser that converts a CSV string into an array of objects.
 * @param {string} csvText - The raw text content of the CSV file.
 * @returns {Array<object>} An array of objects, where each object represents a row.
 */
function parseCSV(csvText) {
    // Split text into lines, ignoring empty lines.
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return []; // Must have at least a header and one data row.
    
    // Extract headers from the first line.
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    // Map each subsequent line to an object using the headers as keys.
    const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] ? values[index].trim().replace(/"/g, '') : '';
        });
        return row;
    });
    return data;
}

/**
 * A helper function to find a value in a row object using multiple possible column headers.
 * This adds flexibility if the CSV header names vary slightly (e.g., "Usage" vs "Usage in kWh").
 * @param {object} row - The row object from the parsed CSV.
 * @param {string[]} possibleHeaders - An array of possible header names to check.
 * @returns {string|null} The value found, or null if no matching header is found.
 */
function findValueInRow(row, possibleHeaders) {
    for (const header of possibleHeaders) {
        if (row[header] !== undefined) {
            return row[header];
        }
    }
    return null;
}

/**
 * Handles the processing of the electricity usage CSV file.
 * @param {Event} event - The file input change event.
 */
export function handleUsageCsv(event) {
    const file = event.target.files[0];
    const statusEl = document.getElementById('usageCounts');
    const fileNameEl = document.getElementById('usageFileName');

    if (!file) {
        if (fileNameEl) fileNameEl.textContent = 'No file chosen';
        if (statusEl) statusEl.textContent = '';
        return;
    }

    if (fileNameEl) fileNameEl.textContent = file.name;
    if (statusEl) statusEl.textContent = 'Processing...';

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const isNem12 = document.getElementById('formatNem12').checked;
            let parsedData;

            if (isNem12) {
                // --- USE THE NEW NEM12 PARSER ---
                parsedData = parseNEM12(e.target.result);
            } else {
                // --- USE THE EXISTING ADVANCED CSV PARSER ---
                const csvData = parseCSV(e.target.result);
                const dailyData = new Map();
                const dateTimeHeader = document.getElementById('elecDateTimeHeader').value;
                const dateFormat = document.getElementById('elecDateFormat').value;
                const typeHeader = document.getElementById('usageTypeHeader').value;
                const consumptionHeaders = document.getElementById('consumptionHeader').value.split(',').map(h => h.trim());
                const importIdentifier = document.getElementById('importIdentifier').value;
                const exportIdentifier = document.getElementById('exportIdentifier').value;
                for (const row of csvData) {
                    const dateTimeString = row[dateTimeHeader];
                    const dateTime = parseDateString(dateTimeString, dateFormat);
                    if (!dateTime || isNaN(dateTime.getTime())) continue;
                    const date = dateTime.toISOString().split('T')[0];
                    const hour = dateTime.getUTCHours();
                    if (!dailyData.has(date)) {
                        dailyData.set(date, { date: date, consumption: Array(24).fill(0), feedIn: Array(24).fill(0) });
                    }
                    const day = dailyData.get(date);
                    const valueString = findValueInRow(row, consumptionHeaders);
                    const value = parseFloat(valueString);
                    if (!isNaN(value)) {
                        const type = row[typeHeader];
                        if (type === importIdentifier) { day.consumption[hour] += value; } 
                        else if (type === exportIdentifier) { day.feedIn[hour] += value; }
                    }
                }
                parsedData = Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
            }

            state.electricityData = parsedData;
            if(statusEl) statusEl.textContent = `${state.electricityData.length} days of usage data loaded.`;
            toggleExistingSolar();

        } catch (err) {
            if(statusEl) statusEl.textContent = 'Failed to process electricity CSV.';
            displayError('Please check the file format and advanced options.', 'data-input-error');
            console.error(err);
        } finally {
            event.target.value = null;
        }
    };
    reader.readAsText(file);
}

/**
 * Handles the processing of the solar generation CSV file.
 * @param {Event} event - The file input change event.
 */
export function handleSolarCsv(event) {
    // Get the selected file from the input event.
    const file = event.target.files[0];
    // Get the UI elements for displaying status and filename.
    const statusEl = document.getElementById('solarCounts');
    const fileNameEl = document.getElementById('solarFileName');

    // If the user cancels the file dialog, reset the UI.
    if (!file) {
        if (fileNameEl) fileNameEl.textContent = 'No file chosen';
        if (statusEl) statusEl.textContent = '';
        return;
    }

    // 1. Immediately display the selected filename in the designated span.
    if (fileNameEl) fileNameEl.textContent = file.name;
    // 2. Show a "Processing..." message to the user.
    if (statusEl) statusEl.textContent = 'Processing...';

    // Initialize FileReader to read the file content.
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            // Parse the raw CSV text into an array of objects.
            const csvData = parseCSV(e.target.result);
            // Use a Map to efficiently aggregate data by date.
            const dailyData = new Map();

            // Read all advanced CSV parsing options from the UI.
            const dateTimeHeader = document.getElementById('solarDateTimeHeader').value;
            const dateFormat = document.getElementById('solarDateFormat').value;
            const generationHeaders = document.getElementById('solarGenerationHeader').value.split(',').map(h => h.trim());

            // Iterate through each row of the parsed CSV data.
            for (const row of csvData) {
                const dateTimeString = row[dateTimeHeader];
                const dateTime = parseDateString(dateTimeString, dateFormat);
                // Skip rows with invalid or unparsable dates.
                if (!dateTime || isNaN(dateTime.getTime())) continue;

                // Standardize date and get the hour for aggregation.
                const date = dateTime.toISOString().split('T')[0];
                const hour = dateTime.getUTCHours();

                // If this is the first entry for a date, initialize its data structure.
                if (!dailyData.has(date)) {
                    dailyData.set(date, { date: date, hourly: Array(24).fill(0), rowCount: 0 });
                }
                const day = dailyData.get(date);

                // Find and parse the energy value, checking multiple possible headers.
                const valueString = findValueInRow(row, generationHeaders);
                const value = parseFloat(valueString);
                
                // Add the value to the hourly array for that day.
                if (!isNaN(value)) {
                    day.hourly[hour] += value;
                    day.rowCount++;
                }
            }

            // Post-processing step: Check for and distribute daily total entries.
            // Some systems export a single daily total at midnight instead of hourly data.
            for (const day of dailyData.values()) {
                const totalForDay = day.hourly.reduce((a,b) => a + b, 0);
                // If a day has only one data row and all the energy is at midnight...
                if (day.rowCount === 1 && day.hourly[0] === totalForDay && totalForDay > 0) {
                    const month = parseInt(day.date.split('-')[1], 10);
                    const season = [12,1,2].includes(month) ? 'Q1_Summer' : [3,4,5].includes(month) ? 'Q2_Autumn' : [6,7,8].includes(month) ? 'Q3_Winter' : 'Q4_Spring';
                    // ...replace the hourly data with a realistic solar curve for that season.
                    day.hourly = generateHourlySolarProfileFromDaily(totalForDay, season);
                }
            }
            // Convert the Map to an array, sort by date, and store in the global state.
            state.solarData = Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
            
            // 3. Update the status message with the successful result.
            if(statusEl) statusEl.textContent = `${state.solarData.length} days of solar data loaded.`;

        } catch (err) {
            // If an error occurs, update the status and log the error.
            if(statusEl) statusEl.textContent = 'Failed to process solar CSV.';
            displayError('Please check the file format and advanced options.', 'data-input-error');
            console.error(err);
        } finally {
            // 4. Reset the hidden input's value. This is crucial to allow
            // the user to re-upload the same file again, triggering the 'change' event.
            event.target.value = null;
        }
    };
    // Start reading the file as text.
    reader.readAsText(file);
} 
 

/**
 * Calculates average daily consumption and solar generation for each quarter/season
 * based on the parsed CSV data. This is used for heuristic calculations.
 * @param {Array} electricityData - The parsed hourly electricity data.
 * @param {Array} solarData - The parsed hourly solar data.
 * @param {object} touHours - An object defining peak and shoulder hours.
 * @returns {object|null} An object containing the calculated averages for each quarter, or null if data is missing.
 */
export function calculateQuarterlyAverages(electricityData, solarData, touHours) {
    if (!electricityData || !solarData) return null;
    
    // Initialize data structure to aggregate totals.
    const quarterlyData = {
        Q1_Summer: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
        Q2_Autumn: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
        Q3_Winter: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
        Q4_Spring: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
    };
    // Use a Map for efficient lookup of a day's total solar generation.
    const solarDataMap = new Map(solarData.map(day => [day.date, day.hourly.reduce((a, b) => a + b, 0)]));

    electricityData.forEach(day => {
        // Determine the season for the current day.
        const month = parseInt(day.date.split('-')[1], 10);
        let season;
        if ([12, 1, 2].includes(month)) season = 'Q1_Summer';
        else if ([3, 4, 5].includes(month)) season = 'Q2_Autumn';
        else if ([6, 7, 8].includes(month)) season = 'Q3_Winter';
        else season = 'Q4_Spring';
        
        const q = quarterlyData[season];
        q.days++;
        q.solar += solarDataMap.get(day.date) || 0;
        
        // Reconstruct true consumption and categorize it into TOU periods.
        for (let h = 0; h < 24; h++) {
            // True consumption = Grid Import + Self-Consumed Solar
            const consumption = day.consumption[h] + Math.max(0, (solarDataMap.get(day.date) || 0) / 24 - day.feedIn[h]);
            if (touHours.peak.includes(h)) q.peak += consumption;
            else if (touHours.shoulder.includes(h)) q.shoulder += consumption;
            else q.offPeak += consumption;
        }
    });

    // Calculate the final daily averages for each quarter.
    const result = {};
    for (const q in quarterlyData) {
        const data = quarterlyData[q];
        result[q] = {
            avgPeak: data.days > 0 ? data.peak / data.days : 0,
            avgShoulder: data.days > 0 ? data.shoulder / data.days : 0,
            avgOffPeak: data.days > 0 ? data.offPeak / data.days : 0,
            avgSolar: data.days > 0 ? data.solar / data.days : 0
        };
    }
    return result;
}