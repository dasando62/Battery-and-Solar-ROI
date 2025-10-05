// js/profiles.js
//Version 1.0.9

import { parseRangesToHours } from './utils.js';

export function generateHourlyConsumptionProfileFromDailyTOU(dailyPeak, dailyShoulder, dailyOffPeak, importRules) {
    const hourlyConsumption = Array(24).fill(0);

    const peakRule = (importRules || []).find(r => r.name.toLowerCase().includes('peak'));
    const shoulderRule = (importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));

    const peakHours = peakRule ? parseRangesToHours(peakRule.hours) : [];
    const shoulderHours = shoulderRule ? parseRangesToHours(shoulderRule.hours) : [];

    // Use length || 1 to prevent division by zero if a period has no hours
    const numPeakHours = peakHours.length || 1;
    const numShoulderHours = shoulderHours.length || 1;
    const numOffPeakHours = 24 - peakHours.length - shoulderHours.length || 1;

    for (let i = 0; i < 24; i++) {
        if (peakHours.includes(i)) {
            hourlyConsumption[i] = dailyPeak / numPeakHours;
        } else if (shoulderHours.includes(i)) {
            hourlyConsumption[i] = dailyShoulder / numShoulderHours;
        } else {
            hourlyConsumption[i] = dailyOffPeak / numOffPeakHours;
        }
    }
    return hourlyConsumption;
}

// --- FIX: Add the missing constant declarations here ---
const genericSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0.01, 0.05, 0.1, 0.15, 0.19, 0.2, 0.15, 0.1, 0.04, 0.01, 0, 0, 0, 0, 0, 0, 0];
const summerSolarDistribution = [0, 0, 0, 0, 0, 0, 0.01, 0.04, 0.08, 0.12, 0.15, 0.18, 0.19, 0.15, 0.12, 0.08, 0.04, 0.01, 0, 0, 0, 0, 0, 0];
const winterSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.1, 0.18, 0.22, 0.2, 0.15, 0.1, 0.0, 0, 0, 0, 0, 0, 0, 0, 0];
const shoulderSolarDistribution = [0, 0, 0, 0, 0, 0, 0, 0.02, 0.06, 0.11, 0.16, 0.19, 0.19, 0.16, 0.11, 0.06, 0.02, 0, 0, 0, 0, 0, 0, 0];
// --- End of fix ---

export function generateHourlySolarProfileFromDaily(dailyTotal, season = 'Q_Manual') {
  if (dailyTotal <= 0) return Array(24).fill(0);

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
    default: 
      distribution = genericSolarDistribution;
      break;
  }

  const distributionTotal = distribution.reduce((a, b) => a + b, 0);
  return distribution.map(val => (val / distributionTotal) * dailyTotal);
}