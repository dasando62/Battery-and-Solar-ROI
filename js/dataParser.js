// js/dataParser.js
import { state } from './state.js';

function getHeaderPossibilities(inputId) {
    const el = document.getElementById(inputId);
    if (!el || !el.value) return [];
    return el.value.split(',').map(h => h.trim());
}

function findHeaderIndex(headerRow, possibleNames) {
    for (const name of possibleNames) {
        const index = headerRow.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
        if (index !== -1) {
            return index;
        }
    }
    return -1;
}

function createDateKey(dateObj) {
    const year = dateObj.getUTCFullYear();
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function calculateQuarterlyAverages(electricityData, solarData = []) {
    if (!electricityData) return null;
    const quarters = {
      'Q1_Summer': { months: [12, 1, 2], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
      'Q2_Autumn': { months: [3, 4, 5], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
      'Q3_Winter': { months: [6, 7, 8], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
      'Q4_Spring': { months: [9, 10, 11], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 }
    };
    const solarDataMap = new Map(solarData.map(day => [day.date, day.hourly.reduce((a, b) => a + b, 0)]));
    electricityData.forEach(day => {
        const date = new Date(day.date);
        if (isNaN(date.getTime())) return;
        const month = date.getUTCMonth() + 1;
        let dailyPeakConsumption = 0, dailyShoulderConsumption = 0, dailyOffPeakConsumption = 0;
        for (let h = 0; h < 24; h++) {
            const consumption = day.consumption[h] || 0;
            if ((h >= 7 && h < 10) || (h >= 16 && h < 22)) dailyPeakConsumption += consumption;
            else if (h >= 10 && h < 16) dailyShoulderConsumption += consumption;
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
        if (quarters[quarter].days > 0) {
            averages[quarter] = {
                avgPeak: quarters[quarter].totalPeak / quarters[quarter].days,
                avgShoulder: quarters[quarter].totalShoulder / quarters[quarter].days,
                avgOffPeak: quarters[quarter].totalOffPeak / quarters[quarter].days,
                avgSolar: quarters[quarter].totalSolar / quarters[quarter].days
            };
        }
    }
    return Object.keys(averages).length > 0 ? averages : null;
}

export async function handleUsageCsv(event) {
    const file = event.target.files[0];
    const countsElement = document.getElementById('usageCounts');
    if (!file || !countsElement) return;
    const typeHeader = getHeaderPossibilities('UsageTypeHeader');
    const kwhHeader = getHeaderPossibilities('consumptionHeader');
    const dateHeader = getHeaderPossibilities('elecDateTimeHeader');
    try {
        const text = await file.text();
        const lines = text.split('\n');
        const headerRow = lines[0].trim().split(/,|\t/);
        let dateIndex = findHeaderIndex(headerRow, dateHeader);
        let typeIndex = findHeaderIndex(headerRow, typeHeader);
        let kwhIndex = findHeaderIndex(headerRow, kwhHeader);
        if (dateIndex === -1 || typeIndex === -1 || kwhIndex === -1) {
            throw new Error("Could not find required columns in Usage CSV. Check Advanced Options.");
        }
        const dailyData = new Map();
        let consumptionCount = 0;
        let feedInCount = 0;
        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].trim().split(/,|\t/);
            if (columns.length <= Math.max(dateIndex, typeIndex, kwhIndex)) continue;
            const dateTimeStr = columns[dateIndex];
            const type = columns[typeIndex].trim();
            const kWh = parseFloat(columns[kwhIndex]);
            if (!dateTimeStr || isNaN(kWh)) continue;
            const dateObj = new Date(dateTimeStr);
            if (isNaN(dateObj.getTime())) continue;
            const dateKey = createDateKey(dateObj);
            const hour = dateObj.getUTCHours();
            if (!dailyData.has(dateKey)) {
                dailyData.set(dateKey, { date: dateKey, consumption: Array(24).fill(0), feedIn: Array(24).fill(0) });
            }
            const day = dailyData.get(dateKey);
            if (type.toLowerCase().includes('consumption')) {
                day.consumption[hour] += kWh;
                consumptionCount++;
            } else if (type.toLowerCase().includes('feed')) {
                day.feedIn[hour] += kWh;
                feedInCount++;
            }
        }
        state.electricityData = Array.from(dailyData.values());
        countsElement.textContent = `Consumption records: ${consumptionCount}, Feed In records: ${feedInCount}`;
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
    const genHeader = getHeaderPossibilities('solarGenerationHeader');
    const dateHeader = getHeaderPossibilities('solarDateTimeHeader');
    try {
        const text = await file.text();
        const lines = text.split('\n');
        const headerRow = lines[0].trim().split(/,|\t/);
        let dateIndex = findHeaderIndex(headerRow, dateHeader);
        let kwhIndex = findHeaderIndex(headerRow, genHeader);
        if (dateIndex === -1 || kwhIndex === -1) {
            throw new Error("Could not find required columns in Solar CSV. Check Advanced Options.");
        }
        const dailyData = new Map();
        let recordCount = 0;
        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].trim().split(/,|\t/);
            if (columns.length <= Math.max(dateIndex, kwhIndex)) continue;
            const dateTimeStr = columns[dateIndex];
            const kWh = parseFloat(columns[kwhIndex]);
            if (!dateTimeStr || isNaN(kWh)) continue;
            let dateObj;
            const dateParts = dateTimeStr.split(' ')[0].split('.');
            if (dateParts.length === 3) {
                dateObj = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
            } else {
                dateObj = new Date(dateTimeStr);
            }
            if (isNaN(dateObj.getTime())) continue;
            const dateKey = createDateKey(dateObj);
            const hour = dateObj.getUTCHours();
            if (!dailyData.has(dateKey)) {
                dailyData.set(dateKey, { date: dateKey, hourly: Array(24).fill(0) });
            }
            const day = dailyData.get(dateKey);
            day.hourly[hour] += kWh;
            recordCount++;
        }
        state.solarData = Array.from(dailyData.values());
        countsElement.textContent = `Total hourly solar records: ${recordCount}`;
        countsElement.style.color = 'green';
    } catch (error) {
        console.error("Error processing solar CSV:", error);
        countsElement.textContent = `Error: ${error.message}`;
        countsElement.style.color = 'red';
    }
}