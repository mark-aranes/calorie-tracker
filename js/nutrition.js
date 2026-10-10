/**
 * Nutrition maths and the coaching engine.
 */

import { ACTIVITIES, ACTIVITY_MULTIPLIERS, GOALS } from './foods.js';

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const round = (n, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/* ---------- energy ---------- */

function ageFrom(birthYear) {
  return Math.max(14, new Date().getFullYear() - birthYear);
}

/** Mifflin-St Jeor basal metabolic rate. */
export function bmr({ sex, birthYear, heightCm, weightKg }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageFrom(birthYear);
  return Math.round(sex === 'female' ? base - 161 : base + 5);
}

/** Maintenance calories = BMR x activity multiplier. */
function maintenance(bmrValue, activity) {
  const factor = ACTIVITY_MULTIPLIERS[activity]?.factor ?? 1.2;
  return Math.round(bmrValue * factor);
}

export function activityBurn(met, minutes, weightKg) {
  return Math.round((met * 3.5 * weightKg) / 200 * minutes);
}

export function metFor(name) {
  return ACTIVITIES.find((a) => a.name === name)?.met ?? 4;
}

/* ---------- daily targets ---------- */

const FEMALE_MIN_KCAL = 1200;
const MALE_MIN_KCAL = 1500;

export function targets(profile) {
  if (!profile) return null;
  const b = bmr(profile);
  const tdee = maintenance(b, profile.activity);
  const goal = GOALS[profile.goal] || GOALS.maintain;

  const sexFloor = profile.sex === 'female' ? FEMALE_MIN_KCAL : MALE_MIN_KCAL;
  const kcal = Math.max(sexFloor, tdee + goal.delta);

  const kg = profile.weightKg;
  const proteinPerKg = { lose_fast: 2.0, lose: 2.0, maintain: 1.6, gain: 1.8 }[profile.goal] ?? 1.6;
  let protein = clamp(Math.round(kg * proteinPerKg), 40, 260);
  protein = Math.min(protein, Math.round((kcal * 0.35) / 4));

  const fatPct = { lose_fast: 0.28, lose: 0.28, maintain: 0.30, gain: 0.26 }[profile.goal] ?? 0.3;
  let fat = Math.round((kcal * fatPct) / 9);
  fat = Math.max(fat, Math.round(kg * 0.6));
  fat = Math.min(fat, Math.round((kcal * 0.35) / 9));

  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return {
    bmr: b,
    tdee,
    kcal,
    protein,
    carbs,
    fat,
    fibre: Math.max(25, Math.round((kcal / 1000) * 14)),
    water: Math.round(kg * 35 + (profile.activity === 'very' || profile.activity === 'athlete' ? 700 : 350)),
    goalLabel: goal.label,
    goalRate: goal.rate,
    weeklyDelta: goal.delta * 7,
  };
}

/* ---------- day maths ---------- */

export function totalsFor(day) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, burned: 0, count: 0 };
  for (const e of day.food || []) {
    t.kcal += e.kcal || 0;
    t.protein += e.protein || 0;
    t.carbs += e.carbs || 0;
    t.fat += e.fat || 0;
    t.fibre += e.fibre || 0;
    t.count++;
  }
  for (const a of day.activity || []) {
    t.burned += a.kcal || 0;
    t.count++;
  }
  t.kcal = Math.round(t.kcal);
  t.burned = Math.round(t.burned);
  t.protein = round(t.protein, 1);
  t.carbs = round(t.carbs, 1);
  t.fat = round(t.fat, 1);
  t.fibre = round(t.fibre, 1);
  return t;
}

/** Fraction of the waking day (07:00-23:00) that has elapsed. */
export function dayProgress(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  return clamp((mins - 7 * 60) / (16 * 60), 0, 1);
}

/* ---------- coaching ---------- */

const advise = (tone, title, body) => ({ tone, title, body });

function categoryCount(day, names) {
  return (day.food || []).filter((e) => names.includes(e.category)).length;
}

const LIQUOR = /beer|wine|spirit|cider|lager/i;
const HIGH_SUGAR = /cola|lemonade|energy drink|smoothie|milkshake|candy|chocolate|sweet|sugar|syrup|honey|cookie|biscuit/i;
const PROTEINY = /Protein|Dairy|chicken|beef|pork|turkey|lamb|salmon|tuna|cod|tilapia|mackerel|shrimp|egg|tofu|tempeh|lentil|chickpea|bean|yoghurt|yogurt|cottage|cheese|milk|protein|edamame|peanut|squid/i;

/**
 * Personalised, time-aware coaching for the selected day.
 */
export function buildAdvice({ totals, tg, profile, day, progress, isToday, now, water = 0, timing = null }) {
  const out = [];
  if (!tg) return out;

  const eaten = totals.kcal;
  const net = eaten - totals.burned;
  const budget = tg.kcal + totals.burned;
  const left = budget - net;
  const overPct = budget > 0 ? (net / budget - 1) * 100 : 0;
  const expected = budget * progress;

  // 1. Where the day stands.
  if (totals.count === 0) {
    out.push(advise('info', 'Nothing logged yet',
      `Your budget for today is ${budget.toLocaleString()} kcal. Start with your first meal whenever you are ready.`));
  } else if (overPct > 12) {
    out.push(advise('warn', `${Math.round(overPct)}% over budget`,
      `You are ${Math.round(overPct * 0.01 * budget)} kcal above today's target. Nothing is lost by one day — keep protein up and make the next meal lighter and higher in vegetables.`));
  } else if (left > budget * 0.25 && progress > 0.6) {
    out.push(advise('warn', 'Eating well under target',
      `${left} kcal still unspent and it is getting late. Consistently eating this far under slows recovery, training and fat loss — add a protein-rich snack.`));
  } else if (Math.abs(overPct) <= 12) {
    out.push(advise('good', 'On track',
      `${Math.round(net)} kcal of ${budget.toLocaleString()} kcal logged. Keep this pace to hit your ${tg.goalLabel.toLowerCase()} goal.`));
  }

  // 2. Pacing — only meaningful for today, partway through.
  if (isToday && totals.count > 0 && progress > 0.25 && progress < 0.95) {
    const diff = eaten - expected;
    if (diff < -budget * 0.3) {
      out.push(advise('warn', 'Eating slower than planned',
        `By now you would expect about ${Math.round(expected)} kcal, so you are roughly ${Math.round(-diff)} kcal behind. Add an extra meal or a snack rather than saving it all for tonight.`));
    } else if (diff > budget * 0.3) {
      out.push(advise('info', 'Front-loaded your intake',
        `${Math.round(eaten)} kcal so far versus about ${Math.round(expected)} expected. That is fine if it suits you, but very front-heavy days tend to end in an evening catch-up.`));
    }
  }

  // 3. Protein — the macronutrient most worth protecting.
  const pGap = tg.protein - totals.protein;
  if (totals.count > 0 && pGap > tg.protein * 0.25) {
    if (progress > 0.5 || !isToday) {
      out.push(advise('tip', 'Protein is behind',
        `${Math.round(totals.protein)} g of ${tg.protein} g so far. Close the ${Math.round(pGap)} g gap with Greek yoghurt, eggs, chicken, tofu or cottage cheese — protein preserves muscle while you lose weight.`));
    } else if (totals.protein === 0) {
      out.push(advise('tip', 'Aim for protein first',
        `Today’s target is ${tg.protein} g of protein (about ${Math.round((tg.protein / Math.max(profile.weightKg, 1)) * 10) / 10} g per kg of body weight). Starting meals with a protein source makes hitting it far easier.`));
    }
  }

  // 4. Macro balance.
  if (totals.carbs > tg.carbs * 1.15 && eaten > 0) {
    out.push(advise('tip', 'Carbs running high',
      `${Math.round(totals.carbs)} g against a ${tg.carbs} g target. A portion of the difference usually comes from sugary drinks and large starch portions at dinner.`));
  }
  if (totals.fat > tg.fat * 1.15 && eaten > 0) {
    out.push(advise('tip', 'Fat running high',
      `${Math.round(totals.fat)} g against a ${tg.fat} g target. Oil, butter, nuts and cheese add up quickly — check portions on the items you logged.`));
  }

  // 5. Fibre.
  if (totals.count > 0 && totals.fibre < tg.fibre * 0.5 && progress > 0.55) {
    out.push(advise('tip', 'Low on fibre',
      `Only ${Math.round(totals.fibre)} g of ${tg.fibre} g. Vegetables, oats, beans, whole grains and fruit with the skin are the quickest way to close the gap.`));
  }

  // 5b. Hydration.
  if (water > 0 || tg.water > 0) {
    if (water >= tg.water) {
      out.push(advise('good', 'Hydration on track', `${water.toLocaleString()} ml logged against a ${tg.water.toLocaleString()} ml target.`));
    } else if (water < tg.water * 0.5 && progress > 0.6) {
      out.push(advise('tip', 'Light on fluids',
        `${water.toLocaleString()} ml so far, roughly ${Math.round((tg.water * 0.35 - water) / 50)} glasses short of a ${tg.water.toLocaleString()} ml target. Water needs no calories and is easy to forget until the evening.`));
    }
  }

  // 5c. Late-evening eating, same-day entries only.
  if (timing && timing.analysed >= 3 && timing.late >= 2) {
    out.push(advise('tip', 'Late-night eating',
      `${timing.late} of ${timing.analysed} meals logged after 21:00 today. Late eating is the easiest thing to change and often the biggest one — it changes what you eat the next morning more than it changes today.`));
  }

  // 6. Food quality from what is actually logged.
  if (totals.count > 0) {
    if (categoryCount(day, ['Vegetables']) === 0 && eaten > tg.kcal * 0.4) {
      out.push(advise('tip', 'No vegetables logged',
        'Vegetables give you volume and fibre for very few calories. Adding a portion to lunch and dinner usually makes the rest of the day easier.'));
    }
    if (categoryCount(day, ['Fruits']) === 0 && eaten > tg.kcal * 0.5) {
      out.push(advise('tip', 'No fruit logged',
        'A piece of fruit covers a useful slice of your carbohydrate and fibre target.'));
    }
    const sugary = (day.food || []).filter((e) => HIGH_SUGAR.test(e.name) && e.kcal > 80);
    if (sugary.length) {
      const cals = sugary.reduce((s, e) => s + e.kcal, 0);
      out.push(advise('tip', `${Math.round(cals)} kcal from sugary items`,
        `Mostly from ${sugary.slice(0, 2).map((e) => e.name).join(' and ')}. Liquid sugar is the easiest to swap for water, sparkling water or tea.`));
    }
    const booze = (day.food || []).filter((e) => LIQUOR.test(e.name));
    if (booze.length) {
      const cals = booze.reduce((s, e) => s + e.kcal, 0);
      out.push(advise('info', 'Alcohol logged',
        `${Math.round(cals)} kcal from alcohol, which carries no protein, fibre or micronutrients and lowers your effective budget for the day.`));
    }
    if (PROTEINY.test(day.food.map((e) => e.name).join(' ')) === false && eaten > tg.kcal * 0.35) {
      out.push(advise('tip', 'No obvious protein source',
        'Add an anchor protein to at least one meal today — it is what keeps you full and protects muscle.'));
    }
  }

  // 7. Balance across meals.
  if ((day.food || []).length >= 3) {
    const biggest = (day.food || []).reduce((a, b) => (a.kcal > b.kcal ? a : b));
    if (eaten > 0 && biggest.kcal > eaten * 0.45 && biggest.kcal > 500) {
      out.push(advise('tip', 'One very large item',
        `${biggest.name} makes up ${Math.round((biggest.kcal / eaten) * 100)}% of today’s intake. If the portion was a misjudgement, edit it — portion size is the most common source of error.`));
    }
  }

  // 8. Movement.
  if (isToday && totals.burned === 0 && progress > 0.5) {
    // Movement assumed by the target but not recorded.
    const implicit = Math.round(-tg.weeklyDelta / 7);
    if (implicit > 120) {
      out.push(advise('tip', 'No activity logged',
        `Your target already assumes roughly ${implicit} kcal a day of movement. Logging workouts separately shows you how much they actually contribute.`));
    }
  }

  return out.slice(0, 6);
}

/* ---------- weight trend & goal projection ---------- */

/** Local ISO helpers so this module stays free of store/UI dependencies. */
function isoOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return isoOf(x);
}

function todayISO() {
  return isoOf(new Date());
}

/**
 * Least-squares slope through the weigh-ins.
 * Endpoints alone are badly skewed by one odd reading, so we fit a line
 * through every point instead. Needs at least three to be meaningful.
 */
export function weightTrend(weights) {
  if (!weights || weights.length < 3) return null;
  const t0 = new Date(weights[0].date + 'T00:00:00').getTime();
  const xs = weights.map((w) => (new Date(w.date + 'T00:00:00').getTime() - t0) / 86400000);
  const ys = weights.map((w) => w.kg);
  const n = xs.length;

  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  if (!den) return null;

  const perDay = num / den;
  return {
    perWeek: perDay * 7,
    perDay,
    first: ys[0],
    last: ys[n - 1],
    change: ys[n - 1] - ys[0],
    spanDays: xs[n - 1] - xs[0],
    points: n,
  };
}

/**
 * Where current behaviour leads, relative to a goal weight.
 * Returns one of: reached / stalled / onTrack / away, or null when there is
 * not enough data to say anything honest.
 */
export function projectGoal(weights, goalKg) {
  if (!goalKg || !weights || !weights.length) return null;
  const current = weights[weights.length - 1].kg;
  const toGo = current - goalKg;

  if (Math.abs(toGo) < 0.05) {
    return { status: 'reached', current, goalKg, toGo: 0, rate: null, days: 0 };
  }

  const trend = weightTrend(weights);
  if (!trend || trend.spanDays < 7) {
    // Too little history for the rate to mean anything.
    return { status: 'unknown', current, goalKg, toGo, rate: null, days: null };
  }

  const rate = trend.perWeek;
  if (Math.abs(rate) < 0.02) {
    return { status: 'stalled', current, goalKg, toGo, rate, days: null };
  }

  const towardGoal = Math.sign(-toGo) === Math.sign(rate);
  const days = Math.round((Math.abs(toGo) / Math.abs(rate)) * 7);
  return {
    status: towardGoal ? 'onTrack' : 'away',
    current, goalKg, toGo, rate, days,
    eta: shiftISO(todayISO(), days),
  };
}

/* ---------- streaks ---------- */

/**
 * Two different numbers, deliberately:
 *  - logging  : consecutive days with any entry, tolerating "today not yet logged"
 *  - onTarget : consecutive completed days within +-10% of budget.
 *               Today is excluded because a half-finished day would count as
 *               a success it has not had yet.
 */
export function streaks(days, tg, today = todayISO()) {
  const foodOf = (iso) => days[iso]?.food || [];
  const logged = (iso) => foodOf(iso).length > 0;
  const kcalOf = (iso) => foodOf(iso).reduce((s, e) => s + (e.kcal || 0), 0);
  const burnedOf = (iso) =>
    (days[iso]?.activity || []).reduce((s, a) => s + (a.kcal || 0), 0);
  const hitTarget = (iso) => {
    const budget = tg.kcal + burnedOf(iso);
    if (budget <= 0 || !logged(iso)) return false;
    return Math.abs((kcalOf(iso) - budget) / budget) <= 0.1;
  };

  const GUARD = 3650;
  let logging = 0;
  let cursor = logged(today) ? today : shiftISO(today, -1);
  while (logging < GUARD && logged(cursor)) {
    logging++;
    cursor = shiftISO(cursor, -1);
  }

  let onTarget = 0;
  let c2 = shiftISO(today, -1);
  while (onTarget < GUARD && hitTarget(c2)) {
    onTarget++;
    c2 = shiftISO(c2, -1);
  }

  return { logging, onTarget, todayLogged: logged(today) };
}

/* ---------- meal timing ---------- */

/**
 * Timing insights use only entries whose timestamp falls on the day being
 * logged. Anything added later (back-dated) carries the time it was *logged*,
 * not the time it was eaten, so it is excluded rather than trusted.
 */
export function timingInsights(days, isos) {
  let analysed = 0, late = 0, backdated = 0;
  const dinnerHours = [];

  for (const iso of isos) {
    const d = days[iso];
    if (!d) continue;
    for (const e of d.food || []) {
      const when = new Date(e.ts || 0);
      if (!e.ts || isoOf(when) !== iso) { backdated++; continue; }
      analysed++;
      const hour = when.getHours() + when.getMinutes() / 60;
      if (hour >= 21) late++;
      if (e.meal === 'Dinner') dinnerHours.push(hour);
    }
  }

  dinnerHours.sort((a, b) => a - b);
  const medianDinner = dinnerHours.length
    ? dinnerHours[Math.floor(dinnerHours.length / 2)]
    : null;

  return {
    analysed,
    backdated,
    late,
    latePct: analysed ? (late / analysed) * 100 : 0,
    medianDinner,
  };
}

/* ---------- multi-day trends ---------- */

/**
 * @param {Array} series [{ date, kcal, burned, protein, carbs, fat, fibre, count }]
 * @param {Object} weights [{ date, kg }]
 */
export function analyseTrends(series, weights, profile, tg) {
  const logged = series.filter((d) => d.count > 0);
  const n = logged.length;
  const avg = (f) => (n ? logged.reduce((s, d) => s + f(d), 0) / n : 0);

  const avgKcal = avg((d) => d.kcal);
  const avgBurned = avg((d) => d.burned);
  const avgProtein = avg((d) => d.protein);
  const avgCarbs = avg((d) => d.carbs);
  const avgFat = avg((d) => d.fat);
  const avgFibre = avg((d) => d.fibre);

  // Days within +/-10% of target count as "on target".
  const budget = (d) => tg.kcal + d.burned;
  const onTarget = logged.filter((d) => budget(d) > 0 && Math.abs((d.kcal - budget(d)) / budget(d)) <= 0.1).length;

  const mean = avgKcal;
  const variance = n ? avg((d) => (d.kcal - mean) ** 2) : 0;
  const sd = Math.sqrt(variance);

  const byWeekday = Array.from({ length: 7 }, () => []);
  for (const d of logged) byWeekday[new Date(d.date + 'T00:00:00').getDay()].push(d.kcal);
  const weekdayAvg = byWeekday.map((arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null));
  const ranked = weekdayAvg
    .map((v, i) => ({ v, i, n: byWeekday[i].length }))
    .filter((x) => x.v !== null && x.n >= 2)
    .sort((a, b) => b.v - a.v);
  const highest = ranked[0];
  const lowest = ranked[ranked.length - 1];

  // Weight trend.
  let weightChange = null;
  let weeklyRate = null;
  if (weights.length >= 2) {
    const first = weights[0];
    const last = weights[weights.length - 1];
    const days = (new Date(last.date) - new Date(first.date)) / 86400000;
    weightChange = last.kg - first.kg;
    if (days >= 1) weeklyRate = (weightChange / days) * 7;
  }

  return {
    n,
    loggedDays: n,
    series,
    avgKcal: Math.round(avgKcal),
    avgBurned: Math.round(avgBurned),
    avgProtein: Math.round(avgProtein),
    avgCarbs: Math.round(avgCarbs),
    avgFat: Math.round(avgFat),
    avgFibre: Math.round(avgFibre),
    onTarget,
    onTargetPct: n ? Math.round((onTarget / n) * 100) : 0,
    sd: Math.round(sd),
    highest,
    lowest,
    weightChange,
    weeklyRate,
    weights,
  };
}

/** Longer-horizon observations, e.g. weekend drift or stalled progress. */
export function trendInsights(t, tg, profile) {
  const out = [];
  if (t.loggedDays < 3) {
    out.push(advise('info', 'Keep logging',
      'Trends need at least three days of data. Log meals for the next few days and useful patterns will appear here.'));
    return out;
  }

  const gap = t.avgKcal - tg.kcal;
  const pct = Math.round((gap / tg.kcal) * 100);
  if (pct > 10) {
    out.push(advise('warn', `Averaging ${pct}% above target`,
      `You are eating about ${Math.abs(gap)} kcal a day more than your target — roughly ${(Math.abs(gap) * 7 / 7700).toFixed(2)} kg per week if it continues. Trimming portions or one sugary drink a day usually closes it.`));
  } else if (pct < -12) {
    out.push(advise('warn', `Averaging ${Math.abs(pct)}% below target`,
      `Eating ${Math.abs(gap)} kcal less than your target each day. Below your maintenance level for long stretches, this costs you muscle as well as fat.`));
  } else {
    out.push(advise('good', 'Calorie intake is well controlled',
      `Your ${t.loggedDays}-day average sits ${Math.abs(pct)}% from target with a spread of ${t.sd} kcal. That is a sustainable pattern.`));
  }

  if (t.sd > t.avgKcal * 0.28 && t.loggedDays >= 5) {
    out.push(advise('tip', 'Day-to-day swing is wide',
      `Your intake ranges by about ${t.sd} kcal either side of the average. Even totals across the week matter more than any single perfect day — smooth the biggest swings first.`));
  }

  if (t.highest && t.lowest && t.highest.i !== t.lowest.i) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const diff = Math.round(t.highest.v - t.lowest.v);
    if (diff > 350) {
      out.push(advise('tip', `${days[t.highest.i]}s run high`,
        `${days[t.highest.i]}s average ${Math.round(t.highest.v)} kcal versus ${Math.round(t.lowest.v)} on ${days[t.lowest.i]}s — a ${diff} kcal gap. Planning the weekend meal in advance is the simplest fix.`));
    }
  }

  if (t.avgProtein > 0) {
    const ratio = t.avgProtein / tg.protein;
    if (ratio < 0.8) {
      out.push(advise('tip', 'Protein is consistently low',
        `${t.avgProtein} g a day against a ${tg.protein} g target. This is the change most likely to make you feel full and keep your weight loss lean.`));
    } else if (ratio >= 0.95) {
      out.push(advise('good', 'Protein target is being met', `${t.avgProtein} g a day on average — right on your ${tg.protein} g target.`));
    }
  }

  if (t.avgFibre < tg.fibre * 0.75) {
    out.push(advise('tip', 'Fibre is below guideline', `${t.avgFibre} g a day versus roughly ${tg.fibre} g. Whole grains, beans and vegetables fix this fastest.`));
  }

  if (t.weeklyRate !== null && Math.abs(t.weeklyRate) > 0.05) {
    const want = { lose_fast: -0.5, lose: -0.3, maintain: 0, gain: 0.3 }[profile.goal];
    const goalWord = profile.goal.startsWith('lose') ? 'losing' : profile.goal === 'gain' ? 'gaining' : 'maintaining';
    if (Math.sign(t.weeklyRate) !== Math.sign(want) && want !== 0) {
      out.push(advise('warn', 'Weight is moving the wrong way',
        `You are ${goalWord === 'losing' ? 'gaining' : 'losing'} about ${Math.abs(t.weeklyRate).toFixed(2)} kg a week against a goal of ${want} kg. Your real intake is higher than your logs suggest — oils, drinks and sauces are the usual culprits.`));
    } else if (Math.abs(t.weeklyRate - want) > Math.max(0.25, Math.abs(want) * 0.6)) {
      out.push(advise('info', 'Progress is faster or slower than planned',
        `You are moving about ${t.weeklyRate.toFixed(2)} kg a week versus a ${want} kg plan. If you feel fine and it is steady, it is usually fine — but adjust your target if it feels too fast.`));
    } else {
      out.push(advise('good', 'Weight trend matches your goal', `${t.weeklyRate.toFixed(2)} kg per week — right in line with a ${want} kg target.`));
    }
  }

  return out.slice(0, 6);
}

export { ACTIVITIES, ACTIVITY_MULTIPLIERS, GOALS };