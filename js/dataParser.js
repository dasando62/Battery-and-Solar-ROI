// js/dataParser.js 
// Version 1.1.2
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
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csvData = parseCSV(e.target.result);
            // Use a Map to aggregate data by date, which is more efficient than searching an array.
            const dailyData = new Map();

            // Read all advanced CSV parsing options from the UI.
            const dateTimeHeader = document.getElementById('elecDateTimeHeader').value;
            const dateFormat = document.getElementById('elecDateFormat').value;
            const typeHeader = document.getElementById('usageTypeHeader').value;
            const consumptionHeaders = document.getElementById('consumptionHeader').value.split(',').map(h => h.trim());
            const importIdentifier = document.getElementById('importIdentifier').value;
            const exportIdentifier = document.getElementById('exportIdentifier').value;

            for (const row of csvData) {
                const dateTimeString = row[dateTimeHeader];
                const dateTime = parseDateString(dateTimeString, dateFormat);
                if (!dateTime || isNaN(dateTime.getTime())) continue; // Skip rows with invalid dates.

                const date = dateTime.toISOString().split('T')[0]; // Standardize date format to 'YYYY-MM-DD'.
                const hour = dateTime.getUTCHours();
                
                // If this is the first entry for this date, initialize its data structure.
                if (!dailyData.has(date)) {
                    dailyData.set(date, {
                        date: date,
                        consumption: Array(24).fill(0), // Grid imports
                        feedIn: Array(24).fill(0)       // Grid exports
                    });
                }
                const day = dailyData.get(date);
                
                const valueString = findValueInRow(row, consumptionHeaders);
                const value = parseFloat(valueString);

                if (!isNaN(value)) {
                    const type = row[typeHeader];
                    // Categorize the value as either import or export based on the identifier.
                    if (type === importIdentifier) {
                        day.consumption[hour] += value;
                    } else if (type === exportIdentifier) {
                        day.feedIn[hour] += value;
                    }
                }
            }

            // Convert the Map values to an array, sort by date, and store in the global state.
            state.electricityData = Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
            document.getElementById('usageCounts').textContent = `${state.electricityData.length} days of usage data loaded.`;
            
            // Update UI elements that depend on usage data being present.
            toggleExistingSolar();

        } catch (err) {
            displayError('Failed to process electricity CSV. Please check the file format and advanced options.', 'data-input-error');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

/**
 * Handles the processing of the solar generation CSV file.
 * @param {Event} event - The file input change event.
 */
export function handleSolarCsv(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csvData = parseCSV(e.target.result);
            const dailyData = new Map();

            // Read solar CSV parsing options from the UI.
            const dateTimeHeader = document.getElementById('solarDateTimeHeader').value;
            const dateFormat = document.getElementById('solarDateFormat').value;
            const generationHeaders = document.getElementById('solarGenerationHeader').value.split(',').map(h => h.trim());

            for (const row of csvData) {
                const dateTimeString = row[dateTimeHeader];
                const dateTime = parseDateString(dateTimeString, dateFormat);
                if (!dateTime || isNaN(dateTime.getTime())) continue;
                
                const date = dateTime.toISOString().split('T')[0];
                const hour = dateTime.getUTCHours();

                if (!dailyData.has(date)) {
                    dailyData.set(date, {
                        date: date,
                        hourly: Array(24).fill(0),
                        rowCount: 0 // Counter to detect daily total entries vs. hourly entries.
                    });
                }
                const day = dailyData.get(date);
                
                const valueString = findValueInRow(row, generationHeaders);
                const value = parseFloat(valueString);

                if (!isNaN(value)) {
                    day.hourly[hour] += value;
                    day.rowCount++; // Increment counter for each valid value found for a day.
                }
            }
            
            // --- Post-processing step: Distribute daily totals ---
            // Some solar monitoring systems export a single daily total at midnight.
            // This logic detects that pattern and distributes the total across a realistic solar curve.
            for (const day of dailyData.values()) {
                // If a day has only one data row and all the energy is at midnight...
                const totalForDay = day.hourly.reduce((a,b) => a + b, 0);
				// Condition: exactly one row for the day, and all energy is in the first hour (00:00).
                if (day.rowCount === 1 && day.hourly[0] === totalForDay && totalForDay > 0) {
                    const month = parseInt(day.date.split('-')[1], 10);
                    const season = [12,1,2].includes(month) ? 'Q1_Summer' : [3,4,5].includes(month) ? 'Q2_Autumn' : [6,7,8].includes(month) ? 'Q3_Winter' : 'Q4_Spring';
                    
                    // ...replace the hourly data with a realistic solar curve.
                    day.hourly = generateHourlySolarProfileFromDaily(totalForDay, season);
                }
            }			

            // Store the processed and sorted data in the global state.
            state.solarData = Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
            document.getElementById('solarCounts').textContent = `${state.solarData.length} days of solar data loaded.`;

        } catch (err) {
            displayError('Failed to process solar CSV. Please check the file format and advanced options.', 'data-input-error');
            console.error(err);
        }
    };
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