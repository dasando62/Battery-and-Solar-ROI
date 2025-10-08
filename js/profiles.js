// js/profiles.js
//Version 1.1.1
// This module provides functions to generate 24-hour energy profiles (consumption and solar)
// from single daily total values, based on typical patterns.

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

import { parseRangesToHours } from './utils.js';

/**
 * Generates a 24-hour consumption profile from daily total kWh values for each Time of Use (TOU) period.
 * It distributes the total for each period evenly across the hours defined for that period.
 * @param {number} dailyPeak - Total kWh consumed during peak hours for the day.
 * @param {number} dailyShoulder - Total kWh consumed during shoulder hours.
 * @param {number} dailyOffPeak - Total kWh consumed during off-peak hours.
 * @param {Array} importRules - The provider's import rules, used to define TOU hours.
 * @returns {number[]} An array of 24 hourly consumption values.
 */
export function generateHourlyConsumptionProfileFromDailyTOU(dailyPeak, dailyShoulder, dailyOffPeak, importRules) {
    const hourlyConsumption = Array(24).fill(0);

    // Find the rules that define the peak and shoulder periods.
    const peakRule = (importRules || []).find(r => r.name.toLowerCase().includes('peak'));
    const shoulderRule = (importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));

    // Parse the hour ranges from the rules into arrays of numbers (0-23).
    const peakHours = peakRule ? parseRangesToHours(peakRule.hours) : [];
    const shoulderHours = shoulderRule ? parseRangesToHours(shoulderRule.hours) : [];

    // Calculate the number of hours in each period.
    // Use `|| 1` to prevent division by zero if a period has no hours defined.
    const numPeakHours = peakHours.length || 1;
    const numShoulderHours = shoulderHours.length || 1;
    const numOffPeakHours = 24 - peakHours.length - shoulderHours.length || 1;

    // Distribute the daily totals across the appropriate hours.
    for (let i = 0; i < 24; i++) {
        if (peakHours.includes(i)) {
            hourlyConsumption[i] = dailyPeak / numPeakHours;
        } else if (shoulderHours.includes(i)) {
            hourlyConsumption[i] = dailyShoulder / numShoulderHours;
        } else {
            // Any hour not in peak or shoulder is considered off-peak.
            hourlyConsumption[i] = dailyOffPeak / numOffPeakHours;
        }
    }
    return hourlyConsumption;
}

// --- Standardized Solar Generation Curves ---
// These arrays represent the percentage of a day's total solar generation that occurs in each hour.
// They sum to 1.0 and are used to create a realistic daily solar profile from a single total value.
const genericSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0.01, 0.05, 0.1, 0.15, 0.19, 0.2, 0.15, 0.1, 0.04, 0.01, 0, 0, 0, 0, 0, 0, 0];
const summerSolarDistribution = [0, 0, 0, 0, 0, 0, 0.01, 0.04, 0.08, 0.12, 0.15, 0.18, 0.19, 0.15, 0.12, 0.08, 0.04, 0.01, 0, 0, 0, 0, 0, 0];
const winterSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.18, 0.22, 0.2, 0.15, 0.1, 0.0, 0, 0, 0, 0, 0, 0, 0, 0];
const shoulderSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0.02, 0.06, 0.11, 0.16, 0.19, 0.19, 0.16, 0.11, 0.06, 0.02, 0, 0, 0, 0, 0, 0, 0];

/**
 * Generates a 24-hour solar generation profile from a single daily total value.
 * @param {number} dailyTotal - The total solar kWh generated for the day.
 * @param {string} [season='Q_Manual'] - The season, which determines which solar curve to use.
 * @returns {number[]} An array of 24 hourly solar generation values.
 */
export function generateHourlySolarProfileFromDaily(dailyTotal, season = 'Q_Manual') {
  if (dailyTotal <= 0) return Array(24).fill(0);

  // Select the appropriate distribution curve based on the season.
  let distribution;
  switch (season) {
    case 'Q1_Summer':
      distribution = summerSolarDistribution;
      break;
    case 'Q3_Winter':
      distribution = winterSolarDistribution;
      break;
    case 'Q2_Autumn':
    case 'Q4_Spring':
      distribution = shoulderSolarDistribution;
      break;
    default: // Fallback for manual mode or unknown seasons.
      distribution = genericSolarDistribution;
      break;
  }

  // Normalize the distribution to ensure the sum of percentages is exactly 1.
  const distributionTotal = distribution.reduce((a, b) => a + b, 0);
  // Map each percentage in the distribution to an actual kWh value.
  return distribution.map(val => (val / distributionTotal) * dailyTotal);
}