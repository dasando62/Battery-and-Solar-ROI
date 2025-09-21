// js/dataParser.js
// Version 7.7

import { state } from './state.js';

// NEW: Helper function to get header names from the UI
function getHeaderPossibilities(inputId) {
    const el = document.getElementById(inputId);
    if (!el || !el.value) return [];
    return el.value.split(',').map(h => h.trim());
}

// NEW: Helper function to find the index of a column given a list of possible names
function findHeaderIndex(headerRow, possibleNames) {
    for (const name of possibleNames) {
        const index = headerRow.indexOf(name);
        if (index !== -1) {
            return index;
        }
    }
    return -1; // Not found
}

function parseISODate(isoString) {
    if (!isoString) return new Date(NaN);
    const datePart = isoString.substring(0, 10);
    const date = new Date(datePart);
    if (isNaN(date.getTime())) return date;
    const timePart = isoString.substring(11, 19);
    const [hours, minutes, seconds] = (timePart.match(/\d{2}/g) || []).map(Number);
    if (hours !== undefined) date.setUTCHours(hours);
    if (minutes !== undefined) date.setUTCMinutes(minutes);
    if (seconds !== undefined) date.setUTCSeconds(seconds);
    return date;
}

function parseFlexibleDate(dateString) {
    if (!dateString) return new Date(NaN);
    const ds = dateString.replace(/[\.\-\/]/g, '/');
    const parts = ds.split('/');
    if (parts.length !== 3) return new Date(NaN);
    let day, month, year;
    if (parts[2].length === 4) { // dd/mm/yyyy
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[2], 10);
    } else if (parts[0].length === 4) { // yyyy/mm/dd
        day = parseInt(parts[2], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[0], 10);
    } else { // dd/mm/yy
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[2], 10) + 2000;
    }
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
        return date;
    }
    return new Date(NaN);
}


export function parseElectricityData(csvContent) {
    const data = {};
    const counts = { consumption: 0, feedIn: 0 };
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    
    // THE FIX: Read header names from the UI
    const usageTypeHeaders = getHeaderPossibilities("UsageTypeHeader");
    const consumptionHeaders = getHeaderPossibilities("consumptionHeader");
    const dateTimeHeaders = getHeaderPossibilities("elecDateTimeHeader");

    const headerLine = lines.find(line => usageTypeHeaders.some(h => line.includes(h)));
    if (!headerLine) throw new Error(`Electricity CSV Error: Header row not found. Expected one of: ${usageTypeHeaders.join(', ')}`);
    
    const headers = headerLine.split(',').map(h => h.trim().replace(/"/g, ''));
    const usageTypeIndex = findHeaderIndex(headers, usageTypeHeaders);
    const usageKwhIndex = findHeaderIndex(headers, consumptionHeaders);
    const fromDateIndex = findHeaderIndex(headers, dateTimeHeaders);

    if (usageTypeIndex === -1 || usageKwhIndex === -1 || fromDateIndex === -1) throw new Error("Electricity CSV Error: Required columns not found. Check your header names in Advanced CSV Options.");
    
    const dataLines = lines.slice(lines.indexOf(headerLine) + 1);
    for (const line of dataLines) {
        const columns = line.split(',').map(c => c.trim().replace(/"/g, ''));
        if (columns.length > Math.max(usageTypeIndex, usageKwhIndex, fromDateIndex)) {
            const usageType = columns[usageTypeIndex];
            const usageKWh = parseFloat(columns[usageKwhIndex]);
            const fromDateTimeStr = columns[fromDateIndex];
            const fromDateTime = parseISODate(fromDateTimeStr);

            if (isNaN(fromDateTime.getTime()) || isNaN(usageKWh)) continue;
            
            const dateKey = fromDateTime.toISOString().split('T')[0];
            const hour = fromDateTime.getUTCHours();

            if (!data[dateKey]) data[dateKey] = { date: dateKey, consumption: Array(24).fill(0), feedIn: Array(24).fill(0) };
            if (usageType === 'Consumption') {
                data[dateKey].consumption[hour] += usageKWh;
                counts.consumption++;
            } else if (usageType === 'Feed In') {
                data[dateKey].feedIn[hour] += usageKWh;
                counts.feedIn++;
            }
        }
    }
    return { data: Object.values(data).sort((a, b) => a.date.localeCompare(b.date)), counts };
}

export function parseSolarData(csvContent) {
    const data = {};
    let count = 0;
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');

    // THE FIX: Read header names from the UI
    const dateTimeHeaders = getHeaderPossibilities("solarDateTimeHeader");
    const generationHeaders = getHeaderPossibilities("solarGenerationHeader");
    
    const headerLine = lines.find(line => dateTimeHeaders.some(h => line.includes(h)));
    if (!headerLine) throw new Error(`Solar CSV Error: Header row not found. Expected one of: ${dateTimeHeaders.join(', ')}`);
    
    const headers = headerLine.split(',').map(h => h.trim().replace(/"/g, ''));
    const dateIndex = findHeaderIndex(headers, dateTimeHeaders);
    const generationIndex = findHeaderIndex(headers, generationHeaders);

    if (dateIndex === -1 || generationIndex === -1) throw new Error("Solar CSV Error: Required columns not found. Check your header names in Advanced CSV Options.");
    
    const dataLines = lines.slice(lines.indexOf(headerLine) + 1);
    for (const line of dataLines) {
        const columns = line.split(',').map(c => c.trim().replace(/"/g, ''));
        if (columns.length > Math.max(dateIndex, generationIndex)) {
            const dateStr = columns[dateIndex];
            const generationKWh = parseFloat(columns[generationIndex]);
            const date = parseFlexibleDate(dateStr);

            if (isNaN(date.getTime()) || isNaN(generationKWh)) continue;
            
            const dateKey = date.toISOString().split('T')[0];
            const hour = date.getUTCHours();

            if (!data[dateKey]) {
                data[dateKey] = { date: dateKey, hourly: Array(24).fill(0) };
            }
            data[dateKey].hourly[hour] += generationKWh;
            count++;
        }
    }
    return { data: Object.values(data).sort((a,b) => a.date.localeCompare(b.date)), count };
}


export function calculateQuarterlyAverages(electricityData, solarData) {
    if (!electricityData || !solarData) return null;
    const quarters = {
      'Q1_Summer': { months: [12, 1, 2], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
      'Q2_Autumn': { months: [3, 4, 5], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
      'Q3_Winter': { months: [6, 7, 8], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 },
      'Q4_Spring': { months: [9, 10, 11], totalPeak: 0, totalShoulder: 0, totalOffPeak: 0, totalSolar: 0, days: 0 }
    };

    const solarDataMap = new Map(solarData.map((day, index) => [electricityData[index]?.date, day]));

    const numDays = Math.min(electricityData.length, solarData.length);
    for (let d = 0; d < numDays; d++) {
      const dateKey = electricityData[d].date;
      const date = new Date(dateKey);
      const month = date.getUTCMonth() + 1;
      let dailyPeakConsumption = 0, dailyShoulderConsumption = 0, dailyOffPeakConsumption = 0;
      for (let h = 0; h < 24; h++) {
        const consumption = electricityData[d].consumption[h] || 0;
        if ((h >= 7 && h < 10) || (h >= 16 && h < 22)) dailyPeakConsumption += consumption;
        else if (h >= 10 && h < 16) dailyShoulderConsumption += consumption;
        else dailyOffPeakConsumption += consumption;
      }
      for (const quarter in quarters) {
        if (quarters[quarter].months.includes(month)) {
          quarters[quarter].totalPeak += dailyPeakConsumption;
          quarters[quarter].totalShoulder += dailyShoulderConsumption;
          quarters[quarter].totalOffPeak += dailyOffPeakConsumption;
          quarters[quarter].totalSolar += solarDataMap.get(dateKey) || 0;
          quarters[quarter].days++;
          break;
        }
      }
    }
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
    return averages;
}

// In js/dataParser.js, replace the existing handleUsageCsv function

export async function handleUsageCsv(event) {
    const file = event.target.files[0];
    const countsElement = document.getElementById('usageCounts');
    if (!file || !countsElement) return;

    // 1. Get the custom header names from the Advanced CSV Options
    const typeHeader = document.getElementById('UsageTypeHeader').value.split(',').map(h => h.trim());
    const kwhHeader = document.getElementById('consumptionHeader').value.split(',').map(h => h.trim());
    const dateHeader = document.getElementById('elecDateTimeHeader').value.split(',').map(h => h.trim());

    try {
        const text = await file.text();
        const lines = text.split('\n');
        const headerRow = lines[0].trim().split(',');

        // 2. Find the index of each required column
        let dateIndex = headerRow.findIndex(h => dateHeader.includes(h.trim()));
        let typeIndex = headerRow.findIndex(h => typeHeader.includes(h.trim()));
        let kwhIndex = headerRow.findIndex(h => kwhHeader.includes(h.trim()));
        if (dateIndex === -1 || typeIndex === -1 || kwhIndex === -1) {
            throw new Error("Could not find required columns. Check 'Advanced CSV Options'.");
        }

        const dailyData = new Map();
        let consumptionCount = 0;
        let feedInCount = 0;

        // 3. Process each data row using the correct column indexes
        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].trim().split(',');
            if (columns.length < headerRow.length) continue;

            const dateTimeStr = columns[dateIndex];
            const type = columns[typeIndex].trim();
            const kWh = parseFloat(columns[kwhIndex]);
            
            if (!dateTimeStr || isNaN(kWh)) continue;
            
            const date = new Date(dateTimeStr).toLocaleDateString('en-AU');
            const hour = new Date(dateTimeStr).getHours();
            
            if (!dailyData.has(date)) {
                dailyData.set(date, { date: date, consumption: Array(24).fill(0), feedIn: Array(24).fill(0) });
            }

            const day = dailyData.get(date);
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

    // 1. Get custom header names
    const genHeader = document.getElementById('solarGenerationHeader').value.split(',').map(h => h.trim());
    const dateHeader = document.getElementById('solarDateTimeHeader').value.split(',').map(h => h.trim());

    try {
        const text = await file.text();
        const lines = text.split('\n');
        const headerRow = lines[0].trim().split(',');

        // 2. Find column indexes
        let dateIndex = headerRow.findIndex(h => dateHeader.includes(h.trim()));
        let kwhIndex = headerRow.findIndex(h => genHeader.includes(h.trim()));

        if (dateIndex === -1 || kwhIndex === -1) {
            throw new Error("Could not find required columns. Check 'Advanced CSV Options'.");
        }
        
        const dailyData = new Map();
        let recordCount = 0;

        // 3. Process data rows
        for (let i = 1; i < lines.length; i++) {
            const columns = lines[i].trim().split(',');
            if (columns.length < headerRow.length) continue;

            const dateTimeStr = columns[dateIndex];
            const kWh = parseFloat(columns[kwhIndex]);

            if (!dateTimeStr || isNaN(kWh)) continue;

            // Handle different date formats, assuming DD.MM.YYYY or standard ISO
            const dateParts = dateTimeStr.split(' ')[0].split('.');
            let date;
            if (dateParts.length === 3) {
                date = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`).toLocaleDateString('en-AU');
            } else {
                date = new Date(dateTimeStr).toLocaleDateString('en-AU');
            }
            
            const hour = new Date(dateTimeStr).getHours();

            if (!dailyData.has(date)) {
                dailyData.set(date, { date: date, hourly: Array(24).fill(0) });
            }
            const day = dailyData.get(date);
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
