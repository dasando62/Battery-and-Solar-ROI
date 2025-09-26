// js/dataParser.js - FINAL CORRECTED VERSION
//Version 9.5
import { state } from './state.js';
import { parseDateString } from './utils.js';
import { generateHourlySolarProfileFromDaily } from './profiles.js';

// --- HELPER FUNCTIONS ---
function getHeaderPossibilities(inputId) {
    const el = document.getElementById(inputId);
    if (!el || !el.value) return [];
    return el.value.split(',').map(h => h.trim());
}

function findHeaderIndex(headerRow, possibleNames) {
    for (const name of possibleNames) {
        const index = headerRow.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
        if (index !== -1) return index;
    }
    return -1;
}

// Uses local time methods (getFullYear, getMonth, getDate)
function createDateKey(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- MAIN FUNCTIONS ---
export function calculateQuarterlyAverages(electricityData, solarData = [], touHours) {
    if (!electricityData) return null;
    const quarters = {
        'Q1_Summer': { months: [12, 1, 2], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
        'Q2_Autumn': { months: [3, 4, 5], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
        'Q3_Winter': { months: [6, 7, 8], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
        'Q4_Spring': { months: [9, 10, 11], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 }
    };
    const solarDataMap = new Map(solarData.map(day => [day.date, day.hourly.reduce((a, b) => a + b, 0)]));
    electricityData.forEach(day => {
        const month = parseInt(day.date.split('-')[1], 10);
        if (isNaN(month)) return;
        let dailyPeakConsumption = 0, dailyShoulderConsumption = 0, dailyOffPeakConsumption = 0;
        for (let h = 0; h < 24; h++) {
            const consumption = day.consumption[h] || 0;
            if (touHours.peak.includes(h)) dailyPeakConsumption += consumption;
            else if (touHours.shoulder.includes(h)) dailyShoulderConsumption += consumption;
            else dailyOffPeakConsumption += consumption;
        }
        for (const quarter in quarters) {
            if (quarters[quarter].months.includes(month)) {
                quarters[quarter].totalPeak += dailyPeakConsumption;
                quarters[quarter].totalShoulder += dailyShoulderConsumption;
                quarters[quarter].totalOffPeak += dailyOffPeakConsumption;
                quarters[quarter].totalSolar += solarDataMap.get(day.date) || 0;
                quarters[quarter].days++;
                break;
            }
        }
    });
    const averages = {};
    for (const quarter in quarters) {
        const q = quarters[quarter];
        if (q.days > 0) {
            averages[quarter] = {
                avgPeak: q.totalPeak / q.days,
                avgShoulder: q.totalShoulder / q.days,
                avgOffPeak: q.totalOffPeak / q.days,
                avgSolar: q.totalSolar / q.days
            };
        }
    }
    return Object.keys(averages).length > 0 ? averages : null;
}

export async function handleUsageCsv(event) {
    const file = event.target.files[0];
    const countsElement = document.getElementById('usageCounts');
    if (!file || !countsElement) return;
    const dateFormat = document.getElementById('elecDateFormat').value;
    const importIdentifier = document.getElementById('importIdentifier').value.toLowerCase();
    const exportIdentifier = document.getElementById('exportIdentifier').value.toLowerCase();
    const typeHeader = getHeaderPossibilities('usageTypeHeader');
    const kwhHeader = getHeaderPossibilities('consumptionHeader');
    const dateHeader = getHeaderPossibilities('elecDateTimeHeader');
    try {
        const text = await file.text();
        const lines = text.split(/\r?\n/);
        const headerRow = lines[0].trim().split(/,|\t/);
        let dateIndex = findHeaderIndex(headerRow, dateHeader);
        let typeIndex = findHeaderIndex(headerRow, typeHeader);
        let kwhIndex = findHeaderIndex(headerRow, kwhHeader);
        if (dateIndex === -1 || typeIndex === -1 || kwhIndex === -1) {
            throw new Error("Could not find required columns in Usage CSV. Check Advanced Options.");
        }
        const dailyData = new Map();
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const columns = lines[i].trim().split(/,|\t/);
            if (!columns[typeIndex] || !columns[dateIndex]) continue;
            const dateTimeStr = columns[dateIndex];
            const typeStr = columns[typeIndex].trim().toLowerCase();
            const kWh = parseFloat(columns[kwhIndex]);
            if (!dateTimeStr || isNaN(kWh)) continue;
            const dateObj = parseDateString(dateTimeStr, dateFormat);
            if (!dateObj || isNaN(dateObj.getTime())) continue;
            const dateKey = createDateKey(dateObj);
            const hour = dateObj.getHours(); // Use local time
            if (!dailyData.has(dateKey)) {
                dailyData.set(dateKey, { date: dateKey, consumption: Array(24).fill(0), feedIn: Array(24).fill(0) });
            }
            const day = dailyData.get(dateKey);
            if (importIdentifier && typeStr.includes(importIdentifier)) {
                day.consumption[hour] += kWh;
            } else if (exportIdentifier && typeStr.includes(exportIdentifier)) {
                day.feedIn[hour] += kWh;
            }
        }
        state.electricityData = Array.from(dailyData.values());
        countsElement.textContent = `Processed ${state.electricityData.length} days of usage data.`;
        countsElement.style.color = 'green';
    } catch (error) {
        console.error("Error processing usage CSV:", error);
        countsElement.textContent = `Error: ${error.message}`;
        countsElement.style.color = 'red';
    }
}

export async function handleSolarCsv(event) {
    const file = event.target.files[0];
    const countsElement = document.getElementById('solarCounts');
    if (!file || !countsElement) return;
    const dateFormat = document.getElementById('solarDateFormat').value;
    const genHeader = getHeaderPossibilities('solarGenerationHeader');
    const dateHeader = getHeaderPossibilities('solarDateTimeHeader');
    try {
        const text = await file.text();
        const lines = text.split(/\r?\n/);
        const headerRow = lines[0].trim().split(/,|\t/);
        let dateIndex = findHeaderIndex(headerRow, dateHeader);
        let kwhIndex = findHeaderIndex(headerRow, genHeader);
        if (dateIndex === -1 || kwhIndex === -1) {
            throw new Error("Could not find required columns in Solar CSV. Check Advanced Options.");
        }
        const dailyData = new Map();
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const columns = lines[i].trim().split(/,|\t/);
            if (!columns[dateIndex] || !columns[kwhIndex]) continue;
            const dateStr = columns[dateIndex];
            const totalDailyKWh = parseFloat(columns[kwhIndex]);
            if (!dateStr || isNaN(totalDailyKWh)) continue;
            const dateObj = parseDateString(dateStr, dateFormat);
            if (!dateObj || isNaN(dateObj.getTime())) continue;
            const dateKey = createDateKey(dateObj);
            const month = dateObj.getMonth() + 1;
            let season = 'Q4_Spring';
            if ([12, 1, 2].includes(month)) season = 'Q1_Summer';
            else if ([3, 4, 5].includes(month)) season = 'Q2_Autumn';
            else if ([6, 7, 8].includes(month)) season = 'Q3_Winter';
            const hourlyGeneration = generateHourlySolarProfileFromDaily(totalDailyKWh, season);
            dailyData.set(dateKey, { date: dateKey, hourly: hourlyGeneration });
        }
        state.solarData = Array.from(dailyData.values());
        countsElement.textContent = `Processed ${state.solarData.length} days of solar data.`;
        countsElement.style.color = 'green';
    } catch (error) {
        console.error("Error processing solar CSV:", error);
        countsElement.textContent = `Error: ${error.message}`;
        countsElement.style.color = 'red';
    }
}