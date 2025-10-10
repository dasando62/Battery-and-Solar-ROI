// js/utils.js
// Version 1.1.4
// This file is a collection of small, reusable utility functions used throughout the application.
// It helps to keep other modules clean and focused on their primary tasks.

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
import { calculateQuarterlyAverages } from './dataParser.js';

/**
 * Determines the season for a given date string.
 * @param {string} date - A date string in 'YYYY-MM-DD' format.
 * @returns {string} The name of the season ('Summer', 'Autumn', 'Winter', 'Spring').
 */
export function getSeason(date) {
    const month = parseInt(date.split('-')[1], 10);
    if ([12, 1, 2].includes(month)) return 'Summer';
    if ([3, 4, 5].includes(month)) return 'Autumn';
    if ([6, 7, 8].includes(month)) return 'Winter';
    return 'Spring';
};

/**
 * Finds the correct tariff rate for a specific hour from a list of rate rules.
 * @param {number} hour - The hour of the day (0-23).
 * @param {Array} rates - An array of rate rule objects.
 * @returns {number} The applicable rate, or 0 if none is found.
 */
export function getRateForHour(hour, rates) {
    for (const rateInfo of rates) {
        if (rateInfo.hours.length > 0 && rateInfo.hours.includes(hour)) return rateInfo.rate;
    }
    // Fallback to a rule with no specific hours (e.g., a general off-peak rate).
    const otherRule = rates.find(r => r.hours.length === 0);
    return otherRule ? otherRule.rate : 0;
}

/**
 * Safely parses a numeric value from an input field by its ID.
 * @param {string} id - The ID of the HTML input element.
 * @param {number} [defaultValue=0] - The value to return if parsing fails or the element is not found.
 * @returns {number} The parsed number or the default value.
 */
export function getNumericInput(id, defaultValue = 0) {
  const el = document.getElementById(id);
  if(!el) return defaultValue;
  const value = parseFloat(el.value);
  return isNaN(value) ? defaultValue : value;
}

/**
 * Sanitizes a string to prevent XSS attacks by converting it to a text node
 * and then reading its innerHTML, which escapes any HTML characters.
 * @param {string} str - The input string to sanitize.
 * @returns {string} The sanitized string.
 */
export function sanitize(str) {
    if (!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

/**
 * Creates a file Blob from a string and triggers a download in the browser.
 * @param {string} filename - The desired name of the downloaded file.
 * @param {string} content - The string content to be put in the file.
 * @param {string} [type='application/json'] - The MIME type of the file.
 */
export function downloadBlob(filename, content, type='application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url); // Clean up the object URL.
}

/**
 * Calculates a future value based on a starting value, an annual rate, and the number of years.
 * Uses the compound interest formula: FV = PV * (1 + r)^(n-1).
 * @param {number} baseValue - The starting value.
 * @param {number} rate - The annual escalation rate as a decimal (e.g., 0.02 for 2%).
 * @param {number} year - The year number (e.g., 1, 2, 3...).
 * @returns {number} The escalated value.
 */
export function escalate(baseValue, rate, year) {
  return baseValue * Math.pow(1 + rate, year - 1);
}

/**
 * Parses a time string (e.g., "7am", "10pm", "14:00") into a 24-hour format number.
 * @param {string} timeStr - The time string to parse.
 * @returns {number|null} The hour (0-23), or null if parsing fails.
 */
function parseTime(timeStr) {
    timeStr = timeStr.toLowerCase().trim();
    let hour = parseInt(timeStr, 10);
    if (isNaN(hour)) return null;
    if (timeStr.includes('am')) {
        if (hour === 12) hour = 0; // 12am is hour 0.
    } else if (timeStr.includes('pm')) {
        if (hour !== 12) hour += 12; // 1pm is 13, 2pm is 14, etc.
    }
    return (hour >= 0 && hour <= 24) ? hour : null;
}

/**
 * Parses a comma-separated string of time ranges (e.g., "7am-10am, 4pm-10pm")
 * into a sorted array of unique hour numbers. Handles overnight ranges.
 * @param {string} rangesStr - The string of time ranges.
 * @returns {number[]} A sorted array of hours (e.g., [7, 8, 9, 16, 17, ...]).
 */
export function parseRangesToHours(rangesStr) {
    if (!rangesStr || typeof rangesStr !== 'string') return [];
    const allHours = new Set(); // Use a Set to automatically handle duplicate hours.
    const ranges = rangesStr.split(',');
    ranges.forEach(range => {
        range = range.trim();
        const parts = range.split('-').map(p => p.trim());
        const start = parseTime(parts[0]);
        if (start === null) return;
        if (parts.length === 1) { // Single hour entry.
            allHours.add(start);
        } else { // Hour range.
            let end = parseTime(parts[1]);
            if (end === null) return;
            if (start < end) { // Standard range (e.g., 7am-10am).
                for (let i = start; i < end; i++) allHours.add(i);
            } else { // Overnight range (e.g., 10pm-7am).
                for (let i = start; i < 24; i++) allHours.add(i); // From start to midnight.
                for (let i = 0; i < end; i++) allHours.add(i);   // From midnight to end.
            }
        }
    });
    return Array.from(allHours).sort((a, b) => a - b);
}

/**
 * A helper to get or calculate and then cache the seasonal average data from CSVs.
 * @param {object} touHours - An object defining TOU hours, needed for the calculation.
 * @param {Array} electricityData - The parsed electricity data.
 * @returns {object|null} The quarterly averages object.
 */
export function getSimulationData(touHours, electricityData) {
    // This function is only for CSV data; manual data is handled directly in the config.
    // If the averages haven't been calculated yet, calculate and cache them in the global state.
    if (!state.quarterlyAverages) {
        if (!electricityData || !state.solarData) return null;
        state.quarterlyAverages = calculateQuarterlyAverages(electricityData, state.solarData, touHours);
    }
    return state.quarterlyAverages;
}

/**
 * Displays an error message in a specified container element.
 * @param {string} message - The error message to display.
 * @param {string} elementId - The ID of the container element for the error message.
 */
export function displayError(message, elementId) {
  const errorContainer = document.getElementById(elementId);
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
  }
}

/**
 * Clears an error message from a specified container or all error containers.
 * @param {string|null} [elementId=null] - The ID of the specific error container to clear. If null, all are cleared.
 */
export function clearError(elementId = null) {
  if (elementId) {
    const errorContainer = document.getElementById(elementId);
    if (errorContainer) {
      errorContainer.textContent = '';
      errorContainer.style.display = 'none';
    }
  } else {
    // If no ID is specified, clear all elements with the .error-message class.
    document.querySelectorAll('.error-message').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
  }
}

/**
 * A flexible date parser that can handle different formats (e.g., YYYY-MM-DD, DD/MM/YYYY)
 * by using a format string to determine the order of date components.
 * @param {string} dateString - The date/time string to parse.
 * @param {string} format - The format of the date part (e.g., "YYYY-MM-DD").
 * @returns {Date|null} A Date object, or null if parsing fails.
 */
export function parseDateString(dateString, format) {
    if (!dateString || !format) return null;
    const parts = dateString.split(/ |T/); // Split date and time parts.
    const datePart = parts[0];
    const timePart = parts.length > 1 ? parts[1] : '00:00';
    const dateSegments = datePart.split(/[-/.]/);
    if (dateSegments.length !== 3) return null;

    // Determine the position of year, month, and day from the format string.
    const formatSegments = format.toUpperCase().split(/[-/.]/);
    const yearIndex = formatSegments.indexOf('YYYY');
    const monthIndex = formatSegments.indexOf('MM');
    const dayIndex = formatSegments.indexOf('DD');
    if (yearIndex === -1 || monthIndex === -1 || dayIndex === -1) return null;
    
    // Extract year, month, and day based on their found positions.
    const year = parseInt(dateSegments[yearIndex], 10);
    const month = parseInt(dateSegments[monthIndex], 10) - 1; // Month is 0-indexed in JS Date.
    const day = parseInt(dateSegments[dayIndex], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    
    // Create a UTC date object to avoid timezone issues.
    const date = new Date(Date.UTC(year, month, day));
    
    // Parse and set the time part.
    const timeSegments = timePart.split(':');
    if (timeSegments.length >= 2) {
        const hours = parseInt(timeSegments[0], 10);
        const minutes = parseInt(timeSegments[1], 10);
        if (!isNaN(hours)) date.setUTCHours(hours);
        if (!isNaN(minutes)) date.setUTCMinutes(minutes);
    }
    
    // Final validation to ensure the parsed date is valid (e.g., not Feb 30).
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
        return date;
    }
    return null;
}

/**
 * Converts a 24-hour number into a 12-hour am/pm format string.
 * @param {number} hour - The hour of the day (0-24).
 * @returns {string} The formatted time string (e.g., "12am", "3pm").
 */
function formatTime(hour) {
    if (hour === 0 || hour === 24) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
}

/**
 * Converts a sorted array of hours into a compact, human-readable range string.
 * e.g., [7, 8, 9, 15, 16] becomes "7am-10am, 3pm-5pm".
 * @param {number[]} hours - A sorted array of hours (0-23).
 * @returns {string} The formatted range string.
 */
export function formatHoursToRanges(hours) {
    if (!hours || hours.length === 0) return 'N/A';
    
    const sortedHours = [...hours].sort((a, b) => a - b);
    const ranges = [];
    let startOfRange = sortedHours[0];
    
    for (let i = 1; i <= sortedHours.length; i++) {
        // If the next hour is not consecutive or we are at the end of the array
        if (i === sortedHours.length || sortedHours[i] !== sortedHours[i - 1] + 1) {
            // The end of a range is the start of the next hour
            const endOfRange = sortedHours[i - 1] + 1;
            ranges.push(`${formatTime(startOfRange)}-${formatTime(endOfRange)}`);
            
            if (i < sortedHours.length) {
                startOfRange = sortedHours[i];
            }
        }
    }
    return ranges.join(', ');
}