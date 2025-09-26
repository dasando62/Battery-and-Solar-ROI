// js/utils.js
//Version 9.5

import { state } from './state.js';
import { calculateQuarterlyAverages } from './dataParser.js';

export function getNumericInput(id, defaultValue = 0) {
  const el = document.getElementById(id);
  if(!el) return defaultValue;
  const value = parseFloat(el.value);
  return isNaN(value) ? defaultValue : value;
}

//export function displayError(message) {
//  const errorContainer = document.getElementById('error-message-container');
//  if (errorContainer) errorContainer.textContent = message;
//}

//export function clearError() {
//  const errorContainer = document.getElementById('error-message-container');
//  if (errorContainer) errorContainer.textContent = '';
//}

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

/**
 * Converts a string of comma-separated hours into human-readable time ranges.
 * Example: "7,8,9,16,17" becomes "7am-10am, 4pm-6pm"
 * @param {string} hoursString - The comma-separated string of hours.
 * @returns {string} The formatted time range string.
 */
export function formatHoursToRanges(hoursString) {
    if (!hoursString || typeof hoursString !== 'string') return "";

    const hours = hoursString.split(',')
        .map(h => parseInt(h.trim(), 10))
        .filter(h => !isNaN(h) && h >= 0 && h <= 23)
        .sort((a, b) => a - b);

    if (hours.length === 0) return "";

    const ranges = [];
    let start = hours[0];
    let end = hours[0];

    for (let i = 1; i < hours.length; i++) {
        if (hours[i] === end + 1) {
            end = hours[i];
        } else {
            ranges.push({ start, end });
            start = hours[i];
            end = hours[i];
        }
    }
    ranges.push({ start, end });

    // Helper to format a single hour (e.g., 13 -> "1pm")
    const formatHour = (hour) => {
        if (hour === 0) return "12am";
        if (hour === 12) return "12pm";
        if (hour < 12) return `${hour}am`;
        return `${hour - 12}pm`;
    };

    return ranges.map(range => {
        if (range.start === range.end) {
            return formatHour(range.start);
        }
        // For a range, the end time is the start of the next hour
        return `${formatHour(range.start)}-${formatHour(range.end + 1)}`;
    }).join(', ');
}
/**
 * Parses a time string (e.g., "7am", "10pm", "12am") into a 24-hour format number.
 * @param {string} timeStr - The time string to parse.
 * @returns {number|null} The hour in 24-hour format, or null if invalid.
 */
function parseTime(timeStr) {
    timeStr = timeStr.toLowerCase().trim();
    let hour = parseInt(timeStr, 10);
    if (isNaN(hour)) return null;

    if (timeStr.includes('am')) {
        if (hour === 12) hour = 0; // 12am is hour 0
    } else if (timeStr.includes('pm')) {
        if (hour !== 12) hour += 12; // 1pm is 13, 2pm is 14, etc.
    }
    
    return (hour >= 0 && hour <= 24) ? hour : null;
}
/**
 * Parses a human-readable time range string into an array of hours.
 * Example: "7am-10am, 4pm-6pm" -> [7, 8, 9, 16, 17]
 * @param {string} rangesStr - The string of time ranges.
 * @returns {number[]} An array of hours.
 */

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

            // CORRECTED LOGIC
            if (start < end) {
                // Normal day range (e.g., 7am-10am)
                for (let i = start; i < end; i++) {
                    allHours.add(i);
                }
            } else {
                // Overnight range (e.g., 10pm-2am)
                // Part 1: from start time to midnight
                for (let i = start; i < 24; i++) {
                    allHours.add(i);
                }
                // Part 2: from midnight to end time
                for (let i = 0; i < end; i++) {
                    allHours.add(i);
                }
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
        // If averages don't exist yet for CSV mode, calculate them now.
        if (!state.quarterlyAverages) {
            // This now correctly uses the 'electricityData' passed into the function
            if (!electricityData || !state.solarData) return null;
            state.quarterlyAverages = calculateQuarterlyAverages(electricityData, state.solarData, touHours);
        }
        return state.quarterlyAverages;
    }
}

/**
 * Calculates the escalated value of a cost or rate over time.
 * @param {number} baseValue - The initial value.
 * @param {number} rate - The annual escalation rate (as a decimal).
 * @param {number} year - The current year of the simulation.
 * @returns {number} The escalated value.
 */
export function displayError(message, elementId) {
  const errorContainer = document.getElementById(elementId);
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
  } else {
    // This is helpful for development, so it's good to keep.
    console.error(`Error display failed: Could not find element with ID "${elementId}".`);
  }
}

/**
 * Clears messages from error containers.
 * If an elementId is provided, clears only that one.
 * If no elementId is provided, clears all error containers.
 */
export function clearError(elementId = null) {
  if (elementId) {
    const errorContainer = document.getElementById(elementId);
    if (errorContainer) {
      errorContainer.textContent = '';
      errorContainer.style.display = 'none';
    }
  } else {
    // Clear all error messages
    document.querySelectorAll('.error-message').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
  }
}

export function parseDateString(dateString, format) {
    // --- TEMPORARY DEBUGGING ---
    // Only log the first time this function is called to avoid flooding the console
    //if (!window.hasLoggedParser) {
        //console.log(`--- Debugging parseDateString ---`);
        //console.log(`1. Received dateString: "${dateString}"`);
        //console.log(`2. Received format: "${format}"`);
        //window.hasLoggedParser = true;
    //}
    // --- END DEBUGGING ---

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
        // --- TEMPORARY DEBUGGING ---
        if (window.hasLoggedParser && !window.hasLoggedParserError) {
            console.log(`3. FAILED: The format string "${format}" is invalid. It must contain YYYY, MM, and DD.`);
            window.hasLoggedParserError = true;
        }
        // --- END DEBUGGING ---
        return null;
    }

    const year = parseInt(dateSegments[yearIndex], 10);
    const month = parseInt(dateSegments[monthIndex], 10) - 1;
    const day = parseInt(dateSegments[dayIndex], 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    
    const date = new Date(year, month, day);

    const timeSegments = timePart.split(':');
    if (timeSegments.length >= 2) {
        const hours = parseInt(timeSegments[0], 10);
        const minutes = parseInt(timeSegments[1], 10);
        if (!isNaN(hours)) date.setHours(hours);
        if (!isNaN(minutes)) date.setMinutes(minutes);
    }

    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
        return date;
    }
    
    return null;
}