/**
 * Scheduler module for running the digest on a schedule
 * Uses node-cron for scheduling
 */

import cron from 'node-cron';
import { config } from './config.js';

let scheduledTask = null;

/**
 * Start the scheduler
 * @param {Function} jobFn - Function to execute on schedule
 * @returns {Object} Scheduled task
 */
export function startScheduler(jobFn) {
  if (scheduledTask) {
    console.log('Scheduler already running');
    return scheduledTask;
  }

  const { cronExpression, timezone } = config.schedule;

  console.log(`Starting scheduler with expression: ${cronExpression} (${timezone})`);
  console.log('Schedule: Every Friday at 5:00 PM Eastern Time');

  // Validate the cron expression
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }

  scheduledTask = cron.schedule(cronExpression, async () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scheduled job starting at ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    try {
      await jobFn();
      console.log('Scheduled job completed successfully');
    } catch (err) {
      console.error('Scheduled job failed:', err);
    }
  }, {
    scheduled: true,
    timezone,
  });

  console.log('Scheduler started successfully');
  console.log(`Next run will be on Friday at 5:00 PM ${timezone}`);

  return scheduledTask;
}

/**
 * Stop the scheduler
 */
export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('Scheduler stopped');
  }
}

/**
 * Get next scheduled run time
 * @returns {Date|null}
 */
export function getNextRunTime() {
  // Calculate next Friday at 5 PM
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;

  const nextFriday = new Date(now);
  nextFriday.setDate(now.getDate() + daysUntilFriday);
  nextFriday.setHours(17, 0, 0, 0);

  // If it's Friday and before 5 PM, next run is today
  if (dayOfWeek === 5 && now.getHours() < 17) {
    const today = new Date(now);
    today.setHours(17, 0, 0, 0);
    return today;
  }

  return nextFriday;
}

/**
 * Format remaining time until next run
 * @returns {string}
 */
export function getTimeUntilNextRun() {
  const next = getNextRunTime();
  if (!next) return 'Unknown';

  const diff = next.getTime() - Date.now();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const parts = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

  return parts.join(', ') || 'Less than a minute';
}
