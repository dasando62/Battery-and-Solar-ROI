// js/utils.js
//Version 7.7
export function getNumericInput(id, defaultValue = 0) {
  const el = document.getElementById(id);
  if(!el) return defaultValue;
  const value = parseFloat(el.value);
  return isNaN(value) ? defaultValue : value;
}

export function displayError(message) {
  const errorContainer = document.getElementById('error-message-container');
  if (errorContainer) errorContainer.textContent = message;
}

export function clearError() {
  const errorContainer = document.getElementById('error-message-container');
  if (errorContainer) errorContainer.textContent = '';
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
            // The end of a range is exclusive, e.g., "7am-10am" includes 7, 8, 9.
            for (let i = start; i < end; i++) {
                allHours.add(i % 24); // Use modulo to handle ranges like 10pm-2am
            }
        }
    });

    return Array.from(allHours).sort((a, b) => a - b);
}