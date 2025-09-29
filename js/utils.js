// js/utils.js
// Version 9.6
import { state } from './state.js';
import { calculateQuarterlyAverages } from './dataParser.js';

export function getRateForHour(hour, rates) {
    for (const rateInfo of rates) {
        if (rateInfo.hours.length > 0 && rateInfo.hours.includes(hour)) return rateInfo.rate;
    }
    const otherRule = rates.find(r => r.hours.length === 0);
    return otherRule ? otherRule.rate : 0;
}

export function getNumericInput(id, defaultValue = 0) {
  const el = document.getElementById(id);
  if(!el) return defaultValue;
  const value = parseFloat(el.value);
  return isNaN(value) ? defaultValue : value;
}

export function sanitize(str) {
    if (!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

export function downloadBlob(filename, content, type='application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function escalate(baseValue, rate, year) {
  return baseValue * Math.pow(1 + rate, year - 1);
}

function parseTime(timeStr) {
    timeStr = timeStr.toLowerCase().trim();
    let hour = parseInt(timeStr, 10);
    if (isNaN(hour)) return null;
    if (timeStr.includes('am')) {
        if (hour === 12) hour = 0;
    } else if (timeStr.includes('pm')) {
        if (hour !== 12) hour += 12;
    }
    return (hour >= 0 && hour <= 24) ? hour : null;
}

export function parseRangesToHours(rangesStr) {
    if (!rangesStr || typeof rangesStr !== 'string') return [];
    const allHours = new Set();
    const ranges = rangesStr.split(',');
    ranges.forEach(range => {
        range = range.trim();
        const parts = range.split('-').map(p => p.trim());
        const start = parseTime(parts[0]);
        if (start === null) return;
        if (parts.length === 1) {
            allHours.add(start);
        } else {
            let end = parseTime(parts[1]);
            if (end === null) return;
            if (start < end) {
                for (let i = start; i < end; i++) allHours.add(i);
            } else {
                for (let i = start; i < 24; i++) allHours.add(i);
                for (let i = 0; i < end; i++) allHours.add(i);
            }
        }
    });
    return Array.from(allHours).sort((a, b) => a - b);
}

export function getSimulationData(touHours, electricityData) {
    const useManual = document.getElementById("manualInputToggle")?.checked;
    if (useManual) {
        return {
            'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
        };
    } else {
        if (!state.quarterlyAverages) {
            if (!electricityData || !state.solarData) return null;
            state.quarterlyAverages = calculateQuarterlyAverages(electricityData, state.solarData, touHours);
        }
        return state.quarterlyAverages;
    }
}

export function displayError(message, elementId) {
  const errorContainer = document.getElementById(elementId);
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
  }
}

export function clearError(elementId = null) {
  if (elementId) {
    const errorContainer = document.getElementById(elementId);
    if (errorContainer) {
      errorContainer.textContent = '';
      errorContainer.style.display = 'none';
    }
  } else {
    document.querySelectorAll('.error-message').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
  }
}

// --- THIS FUNCTION WAS MISSING ---
export function parseDateString(dateString, format) {
    if (!dateString || !format) return null;
    const parts = dateString.split(/ |T/);
    const datePart = parts[0];
    const timePart = parts.length > 1 ? parts[1] : '00:00';
    const dateSegments = datePart.split(/[-/.]/);
    if (dateSegments.length !== 3) return null;
    const formatSegments = format.toUpperCase().split(/[-/.]/);
    const yearIndex = formatSegments.indexOf('YYYY');
    const monthIndex = formatSegments.indexOf('MM');
    const dayIndex = formatSegments.indexOf('DD');
    if (yearIndex === -1 || monthIndex === -1 || dayIndex === -1) {
        return null;
    }
    const year = parseInt(dateSegments[yearIndex], 10);
    const month = parseInt(dateSegments[monthIndex], 10) - 1;
    const day = parseInt(dateSegments[dayIndex], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    const date = new Date(Date.UTC(year, month, day));
    const timeSegments = timePart.split(':');
    if (timeSegments.length >= 2) {
        const hours = parseInt(timeSegments[0], 10);
        const minutes = parseInt(timeSegments[1], 10);
        if (!isNaN(hours)) date.setUTCHours(hours);
        if (!isNaN(minutes)) date.setUTCMinutes(minutes);
    }
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
        return date;
    }
    return null;
}