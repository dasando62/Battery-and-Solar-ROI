// js/state.js
//Version 1.1.2
// This file defines and exports a central, global `state` object.
// This object acts as a single source of truth for shared application data,
// making it accessible across different modules without passing it as a function parameter everywhere.

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

export const state = {
  // Holds the parsed hourly electricity usage data from the CSV file.
  electricityData: null,
  // Holds the parsed hourly solar generation data from the CSV file.
  solarData: null,
  // Caches the calculated quarterly averages from the CSV data.
  quarterlyAverages: null,
  // Holds the instance of the main Chart.js savings chart for exporting.
  savingsChart: null,
  // Holds the instance of the peak period distribution chart for exporting.
  peakPeriodChart: null,
  // Holds the instance of the max hourly load distribution chart for exporting.
  maxHourlyChart: null,
  // Stores the final, calculated financial results from the analysis.
  analysisResults: null,
  // Stores the configuration object that was used to generate the results.
  analysisConfig: null,
  // DEPRECATED: These are now part of the `analysisResults` object.
  analysisBaselineCosts: null,
  analysisSelectedProviders: null,
};