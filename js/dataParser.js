// js/dataParser.js 
// Version 1.1.0

import { state } from './state.js';
import { displayError, parseDateString } from './utils.js';
import { toggleExistingSolar } from './uiEvents.js';
import { generateHourlySolarProfileFromDaily } from './profiles.js';

function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
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

// A new helper function to find a value in a row using multiple possible column headers
function findValueInRow(row, possibleHeaders) {
    for (const header of possibleHeaders) {
        if (row[header] !== undefined) {
            return row[header];
        }
    }
    return null;
}

export function handleUsageCsv(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csvData = parseCSV(e.target.result);
            const dailyData = new Map();

            // --- CORRECTLY read all advanced options ---
            const dateTimeHeader = document.getElementById('elecDateTimeHeader').value;
            const dateFormat = document.getElementById('elecDateFormat').value;
            const typeHeader = document.getElementById('usageTypeHeader').value;
            const consumptionHeaders = document.getElementById('consumptionHeader').value.split(',').map(h => h.trim());
            const importIdentifier = document.getElementById('importIdentifier').value;
            const exportIdentifier = document.getElementById('exportIdentifier').value; // <-- Now being used

            for (const row of csvData) {
                const dateTimeString = row[dateTimeHeader];
                const dateTime = parseDateString(dateTimeString, dateFormat);
                if (!dateTime || isNaN(dateTime.getTime())) continue;

                const date = dateTime.toISOString().split('T')[0];
                const hour = dateTime.getUTCHours();
                
                if (!dailyData.has(date)) {
                    dailyData.set(date, {
                        date: date,
                        consumption: Array(24).fill(0),
                        feedIn: Array(24).fill(0)
                    });
                }
                const day = dailyData.get(date);
                
                // --- CORRECTLY find the value using all possible headers ---
                const valueString = findValueInRow(row, consumptionHeaders);
                const value = parseFloat(valueString);

                if (!isNaN(value)) {
                    const type = row[typeHeader];
                    if (type === importIdentifier) {
                        day.consumption[hour] += value;
                    } else if (type === exportIdentifier) { // <-- Now correctly checks for the export type
                        day.feedIn[hour] += value;
                    }
                }
            }

            state.electricityData = Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
            document.getElementById('usageCounts').textContent = `${state.electricityData.length} days of usage data loaded.`;
            
            toggleExistingSolar();

        } catch (err) {
            displayError('Failed to process electricity CSV. Please check the file format and advanced options.', 'data-input-error');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

export function handleSolarCsv(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csvData = parseCSV(e.target.result);
            const dailyData = new Map();

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
                        rowCount: 0 // <-- MODIFIED: Add a counter
                    });
                }
                const day = dailyData.get(date);
                
                const valueString = findValueInRow(row, generationHeaders);
                const value = parseFloat(valueString);

                if (!isNaN(value)) {
                    day.hourly[hour] += value;
                    day.rowCount++; // <-- MODIFIED: Increment the counter
                }
            }
            
            // --- ADDED: Check for and distribute daily totals ---
            for (const day of dailyData.values()) {
                // If a day has only one data row and all the energy is at midnight...
                const totalForDay = day.hourly.reduce((a,b) => a + b, 0);
                if (day.rowCount === 1 && day.hourly[0] === totalForDay && totalForDay > 0) {
                    const month = parseInt(day.date.split('-')[1], 10);
                    const season = [12,1,2].includes(month) ? 'Q1_Summer' : [3,4,5].includes(month) ? 'Q2_Autumn' : [6,7,8].includes(month) ? 'Q3_Winter' : 'Q4_Spring';
                    
                    // ...replace the hourly data with a realistic solar curve.
                    day.hourly = generateHourlySolarProfileFromDaily(totalForDay, season);
                }
            }

            state.solarData = Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
            document.getElementById('solarCounts').textContent = `${state.solarData.length} days of solar data loaded.`;

        } catch (err) {
            displayError('Failed to process solar CSV. Please check the file format and advanced options.', 'data-input-error');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

export function calculateQuarterlyAverages(electricityData, solarData, touHours) {
    if (!electricityData || !solarData) return null;
    const quarterlyData = {
        Q1_Summer: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
        Q2_Autumn: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
        Q3_Winter: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
        Q4_Spring: { days: 0, peak: 0, shoulder: 0, offPeak: 0, solar: 0 },
    };
    const solarDataMap = new Map(solarData.map(day => [day.date, day.hourly.reduce((a, b) => a + b, 0)]));

    electricityData.forEach(day => {
        const month = parseInt(day.date.split('-')[1], 10);
        let season;
        if ([12, 1, 2].includes(month)) season = 'Q1_Summer';
        else if ([3, 4, 5].includes(month)) season = 'Q2_Autumn';
        else if ([6, 7, 8].includes(month)) season = 'Q3_Winter';
        else season = 'Q4_Spring';
        
        const q = quarterlyData[season];
        q.days++;
        q.solar += solarDataMap.get(day.date) || 0;
        
        for (let h = 0; h < 24; h++) {
            const consumption = day.consumption[h] + Math.max(0, (solarDataMap.get(day.date) || 0) / 24 - day.feedIn[h]);
            if (touHours.peak.includes(h)) q.peak += consumption;
            else if (touHours.shoulder.includes(h)) q.shoulder += consumption;
            else q.offPeak += consumption;
        }
    });

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