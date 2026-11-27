/**
 * Collatz Lab — Core Calculation Engine & Interactive Visualizer
 * Uses arbitrary-precision BigInt arithmetic with safe Chart.js scaling.
 */

(() => {
  'use strict';

  /* ========================================================================
     1. MATHEMATICAL CALCULATION ENGINE (Pure Logic, Arbitrary Precision)
     ======================================================================== */

  const SAFEGUARDS = {
    MAX_INPUT_DIGITS: 1000,
    MAX_STEPS: 50000,
    MAX_SAFE_BIGINT: BigInt(Number.MAX_SAFE_INTEGER) // 9007199254740991n
  };

  /**
   * Validates user input string and parses into a strictly positive BigInt.
   * Rejects zero, negative numbers, decimals, whitespace-only, or non-digits.
   * @param {string} rawInput
   * @returns {{ valid: boolean, value?: bigint, error?: string }}
   */
  function parsePositiveBigInt(rawInput) {
    if (typeof rawInput !== 'string') {
      return { valid: false, error: 'Invalid input type.' };
    }

    const trimmed = rawInput.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'Please enter a positive integer.' };
    }

    if (trimmed.length > SAFEGUARDS.MAX_INPUT_DIGITS) {
      return {
        valid: false,
        error: `Input exceeds safety limit of ${SAFEGUARDS.MAX_INPUT_DIGITS} digits.`
      };
    }

    // Strict positive integer check (allows optional leading '+', rejects '-', '.', 'e', letters)
    if (!/^\+?\d+$/.test(trimmed)) {
      return {
        valid: false,
        error: 'Invalid input. Only positive integers (1, 2, 3, ...) are permitted.'
      };
    }

    const parsed = BigInt(trimmed);
    if (parsed <= 0n) {
      return {
        valid: false,
        error: 'Input must be strictly greater than zero (n ≥ 1).'
      };
    }

    return { valid: true, value: parsed };
  }

  /**
   * Computes high-precision base-10 logarithm of a positive BigInt
   * without converting the entire BigInt to Number (preventing Infinity overflow).
   * @param {bigint} value
   * @returns {number}
   */
  function bigIntLog10(value) {
    if (value <= 0n) return 0;
    const str = value.toString();
    const numDigits = str.length;
    // Take top 15 significant digits for IEEE-754 mantissa precision
    const leadingDigits = Number(str.slice(0, 15));
    const scaleAdjustment = numDigits - Math.min(15, numDigits);
    return Math.log10(leadingDigits) + scaleAdjustment;
  }

  /**
   * Converts a BigInt to a safe plotting coordinate.
   * If any value in the sequence exceeds Number.MAX_SAFE_INTEGER, or if log mode
   * is active, uses exact base-10 logarithmic scaling so no precision loss occurs.
   * @param {bigint} value
   * @param {boolean} useLogScale
   * @returns {number}
   */
  function toPlottableValue(value, useLogScale) {
    if (useLogScale) {
      return bigIntLog10(value);
    }
    if (value <= SAFEGUARDS.MAX_SAFE_BIGINT) {
      return Number(value);
    }
    // Fallback safeguard (auto-switches to log scale in controller when exceeded)
    return bigIntLog10(value);
  }

  /**
   * Generates the complete Collatz sequence and summary statistics using BigInt.
   * Rule:
   *   if n is even: n / 2
   *   if n is odd:  3n + 1
   * @param {bigint} startValue
   * @returns {object} Sequence data, statistics, and precision metadata
   */
  function computeCollatzSequence(startValue) {
    const sequence = [];
    let current = startValue;
    let maxVal = startValue;
    let maxIteration = 0;
    let iteration = 0;
    let requiresScaledAxis = startValue > SAFEGUARDS.MAX_SAFE_BIGINT;

    // Record initial state (iteration 0)
    sequence.push({
      iteration: 0,
      value: current,
      isOdd: (current & 1n) === 1n
    });

    while (current !== 1n) {
      if (iteration >= SAFEGUARDS.MAX_STEPS) {
        throw new Error(
          `Computation halted at safety limit of ${SAFEGUARDS.MAX_STEPS.toLocaleString()} steps.`
        );
      }

      // Bitwise parity check on BigInt: (current & 1n) === 0n means even
      if ((current & 1n) === 0n) {
        current = current / 2n;
      } else {
        current = 3n * current + 1n;
      }

      iteration += 1;

      if (current > maxVal) {
        maxVal = current;
        maxIteration = iteration;
      }

      if (current > SAFEGUARDS.MAX_SAFE_BIGINT) {
        requiresScaledAxis = true;
      }

      sequence.push({
        iteration,
        value: current,
        isOdd: (current & 1n) === 1n
      });
    }

    return {
      startValue,
      steps: iteration,
      maxValue: maxVal,
      maxIteration,
      finalValue: 1n,
      requiresScaledAxis,
      sequence
    };
  }

  /**
   * Formats a BigInt with thousands separators for readability.
   * @param {bigint} num
   * @returns {string}
   */
  function formatBigInt(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ========================================================================
     2. APPLICATION STATE & DOM REFERENCES
     ======================================================================== */

  const state = {
    result: null,
    chart: null,
    useLogScale: false,
    forcedLogScale: false,
    animation: {
      isPlaying: false,
      isPaused: false,
      currentIndex: 0,
      timerId: null,
      delayMs: 60
    }
  };

  const dom = {
    input: document.getElementById('number-input'),
    calcBtn: document.getElementById('calculate-btn'),
    resetBtn: document.getElementById('reset-btn'),
    feedback: document.getElementById('input-feedback'),
    presetBtns: document.querySelectorAll('.btn-chip'),

    statStart: document.getElementById('stat-start'),
    statSteps: document.getElementById('stat-steps'),
    statMax: document.getElementById('stat-max'),
    statMaxIter: document.getElementById('stat-max-iter'),
    statFinal: document.getElementById('stat-final'),

    scaleNotice: document.getElementById('scale-notice'),
    scaleToggleBtn: document.getElementById('scale-toggle-btn'),

    animPlayBtn: document.getElementById('anim-play-btn'),
    animPauseBtn: document.getElementById('anim-pause-btn'),
    animResetBtn: document.getElementById('anim-reset-btn'),
    speedSlider: document.getElementById('speed-slider'),
    speedLabel: document.getElementById('speed-label'),
    animStatus: document.getElementById('anim-status'),

    chartCanvas: document.getElementById('collatz-chart'),
    sequenceList: document.getElementById('sequence-list'),
    sequenceMeta: document.getElementById('sequence-meta'),
    copySeqBtn: document.getElementById('copy-seq-btn')
  };

  /* ========================================================================
     3. CHART.JS VISUALIZATION MODULE
     ======================================================================== */

  const POINT_COLORS = {
    start: '#a855f7', // Purple
    odd: '#f97316',   // Orange
    even: '#38bdf8',  // Blue
    end: '#10b981'    // Green
  };

  /**
   * Determines point color based on position and parity.
   */
  function getPointColor(item, totalLength) {
    if (item.iteration === 0) return POINT_COLORS.start;
    if (item.iteration === totalLength - 1 && item.value === 1n) return POINT_COLORS.end;
    return item.isOdd ? POINT_COLORS.odd : POINT_COLORS.even;
  }

  /**
   * Determines point radius to emphasize start, terminal, and active animation nodes.
   */
  function getPointRadius(item, totalLength, isAnimating) {
    if (totalLength > 800) {
      if (item.iteration === 0 || item.iteration === totalLength - 1) return 5;
      return 2;
    }
    if (item.iteration === 0 || item.iteration === totalLength - 1) return 6.5;
    if (isAnimating && item.iteration === totalLength - 1) return 7;
    return 4.2;
  }

  /**
   * Builds Chart.js datasets for a slice of the sequence (full or animated prefix).
   */
  function buildChartPayload(sliceLength) {
    const seq = state.result.sequence;
    const totalLen = seq.length;
    const count = Math.min(sliceLength, totalLen);
    const isLog = state.useLogScale;

    const labels = new Array(count);
    const dataPoints = new Array(count);
    const pointColors = new Array(count);
    const pointRadii = new Array(count);

    for (let i = 0; i < count; i++) {
      const item = seq[i];
      labels[i] = item.iteration;
      dataPoints[i] = {
        x: item.iteration,
        y: toPlottableValue(item.value, isLog),
        exactValue: formatBigInt(item.value),
        parity: item.isOdd ? 'Odd (3n + 1)' : 'Even (n / 2)'
      };
      pointColors[i] = getPointColor(item, totalLen);
      pointRadii[i] = getPointRadius(item, count, count < totalLen);
    }

    return { labels, dataPoints, pointColors, pointRadii };
  }

  /**
   * Initializes or updates the Chart.js instance.
   */
  function renderChart(sliceLength = null) {
    if (!state.result) return;

    const targetCount = sliceLength !== null ? sliceLength : state.result.sequence.length;
    const payload = buildChartPayload(targetCount);
    const yAxisTitle = state.useLogScale
      ? 'Log₁₀ Numerical Value (Exact BigInt in Tooltip)'
      : 'Numerical Value';

    if (state.chart) {
      state.chart.data.labels = payload.labels;
      const dataset = state.chart.data.datasets[0];
      dataset.data = payload.dataPoints;
      dataset.pointBackgroundColor = payload.pointColors;
      dataset.pointBorderColor = payload.pointColors;
      dataset.pointRadius = payload.pointRadii;
      state.chart.options.scales.y.title.text = yAxisTitle;
      if (state.animation.isPlaying) {
        state.chart.options.animation = {
          duration: state.animation.delayMs,
          easing: 'linear'
        };
        state.chart.update();
      } else {
        state.chart.options.animation = false;
        state.chart.update('none');
      }
      return;
    }

    const ctx = dom.chartCanvas.getContext('2d');
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: payload.labels,
        datasets: [
          {
            label: 'Collatz Trajectory',
            data: payload.dataPoints,
            borderColor: 'rgba(6, 182, 212, 0.72)',
            borderWidth: 2,
            tension: 0.12,
            fill: {
              target: 'origin',
              above: 'rgba(6, 182, 212, 0.06)'
            },
            pointBackgroundColor: payload.pointColors,
            pointBorderColor: payload.pointColors,
            pointRadius: payload.pointRadii,
            pointHoverRadius: 7.5,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: '#ffffff'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            titleColor: '#06b6d4',
            bodyColor: '#f1f5f9',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            titleFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            callbacks: {
              title(items) {
                if (!items.length) return '';
                const raw = items[0].raw;
                return `Iteration #${raw.x}`;
              },
              label(context) {
                const raw = context.raw;
                return [
                  ` Value:  ${raw.exactValue}`,
                  ` Parity: ${raw.parity}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Iteration Number (Step)',
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: '600' }
            },
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono', size: 11 },
              precision: 0
            },
            grid: {
              color: 'rgba(51, 65, 85, 0.4)'
            }
          },
          y: {
            type: 'linear',
            title: {
              display: true,
              text: yAxisTitle,
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: '600' }
            },
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono', size: 11 },
              callback(value) {
                if (state.useLogScale) {
                  return `10^${Number(value).toFixed(1)}`;
                }
                return Number(value).toLocaleString();
              }
            },
            grid: {
              color: 'rgba(51, 65, 85, 0.4)'
            }
          }
        }
      }
    });
  }

  /* ========================================================================
     4. UI RENDERING MODULE (Statistics & Sequence Tokens)
     ======================================================================== */

  function updateStatisticsUI(result) {
    dom.statStart.textContent = formatBigInt(result.startValue);
    dom.statSteps.textContent = result.steps.toLocaleString();
    dom.statMax.textContent = formatBigInt(result.maxValue);
    dom.statMaxIter.textContent = `Step #${result.maxIteration.toLocaleString()}`;
    dom.statFinal.textContent = formatBigInt(result.finalValue);
  }

  function updateScaleControlsUI() {
    if (state.forcedLogScale) {
      dom.scaleToggleBtn.textContent = 'Scale: Log₁₀ (BigInt Safe)';
      dom.scaleToggleBtn.disabled = true;
      dom.scaleNotice.textContent =
        'Log₁₀ scale enforced automatically (>2⁵³ safe integer range) • Exact BigInt values preserved in tooltips';
    } else {
      dom.scaleToggleBtn.disabled = false;
      dom.scaleToggleBtn.textContent = state.useLogScale ? 'Scale: Log₁₀' : 'Scale: Linear';
      dom.scaleNotice.textContent = `${
        state.useLogScale ? 'Logarithmic (Log₁₀)' : 'Linear'
      } scale • Zoom and pan disabled`;
    }
  }

  /**
   * Renders the complete sequence of colored badges inside the scrollable container.
   */
  function renderSequenceList(result) {
    const fragment = document.createDocumentFragment();
    const seq = result.sequence;
    const total = seq.length;

    seq.forEach((item, index) => {
      const span = document.createElement('span');
      span.className = 'seq-token';
      span.dataset.index = String(index);
      span.setAttribute('role', 'listitem');
      span.textContent = formatBigInt(item.value);

      if (index === 0) {
        span.classList.add('start-node');
        span.title = `Step 0 (Start): ${formatBigInt(item.value)}`;
      } else if (index === total - 1) {
        span.classList.add('end-node');
        span.title = `Step ${index} (Terminal): 1`;
      } else {
        span.classList.add(item.isOdd ? 'odd' : 'even');
        span.title = `Step ${index} (${item.isOdd ? 'Odd' : 'Even'}): ${formatBigInt(item.value)}`;
      }

      fragment.appendChild(span);

      if (index < total - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'seq-arrow';
        arrow.textContent = '→';
        arrow.setAttribute('aria-hidden', 'true');
        fragment.appendChild(arrow);
      }
    });

    dom.sequenceList.innerHTML = '';
    dom.sequenceList.appendChild(fragment);
    dom.sequenceMeta.textContent = `${total.toLocaleString()} total terms (${result.steps.toLocaleString()} transitions)`;
  }

  /**
   * Highlights the active token during step-by-step animation and auto-scrolls smoothly.
   */
  function highlightActiveSequenceToken(activeIndex) {
    const prev = dom.sequenceList.querySelector('.seq-token.active-step');
    if (prev) prev.classList.remove('active-step');

    if (activeIndex === null || activeIndex < 0) return;

    const target = dom.sequenceList.querySelector(`.seq-token[data-index="${activeIndex}"]`);
    if (target) {
      target.classList.add('active-step');
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /* ========================================================================
     5. ANIMATION CONTROLLER
     ======================================================================== */

  function stopAnimationTimer() {
    if (state.animation.timerId !== null) {
      clearTimeout(state.animation.timerId);
      state.animation.timerId = null;
    }
  }

  function updateAnimationControlsUI() {
    const { isPlaying, isPaused, currentIndex } = state.animation;
    const total = state.result ? state.result.sequence.length : 0;

    if (isPlaying) {
      dom.animPlayBtn.disabled = true;
      dom.animPauseBtn.disabled = false;
      dom.animPlayBtn.textContent = '▶ Playing...';
    } else if (isPaused) {
      dom.animPlayBtn.disabled = false;
      dom.animPauseBtn.disabled = true;
      dom.animPlayBtn.textContent = '▶ Resume';
    } else {
      dom.animPlayBtn.disabled = false;
      dom.animPauseBtn.disabled = true;
      dom.animPlayBtn.textContent = '▶ Play';
    }

    if (!state.result) {
      dom.animStatus.textContent = 'No sequence loaded';
    } else if (isPlaying || isPaused) {
      const stepItem = state.result.sequence[Math.min(currentIndex, total - 1)];
      dom.animStatus.textContent = `Step ${stepItem.iteration} / ${
        total - 1
      } • Value: ${formatBigInt(stepItem.value)}`;
    } else {
      dom.animStatus.textContent = `Ready • Full trajectory (${total - 1} steps)`;
    }
  }

  function runAnimationStep() {
    if (!state.animation.isPlaying || !state.result) return;

    const total = state.result.sequence.length;
    const idx = state.animation.currentIndex;

    renderChart(idx + 1);
    highlightActiveSequenceToken(idx);
    updateAnimationControlsUI();

    if (idx >= total - 1) {
      // Animation completed
      state.animation.isPlaying = false;
      state.animation.isPaused = false;
      updateAnimationControlsUI();
      dom.animStatus.textContent = `Completed • Reached 1 in ${total - 1} steps`;
      return;
    }

    state.animation.currentIndex += 1;
    state.animation.timerId = setTimeout(runAnimationStep, state.animation.delayMs);
  }

  function startOrResumeAnimation() {
    if (!state.result) return;
    const total = state.result.sequence.length;

    // If starting fresh or restarting after completion
    if (!state.animation.isPaused || state.animation.currentIndex >= total - 1) {
      state.animation.currentIndex = 0;
    }

    state.animation.isPlaying = true;
    state.animation.isPaused = false;
    updateAnimationControlsUI();
    runAnimationStep();
  }

  function pauseAnimation() {
    if (!state.animation.isPlaying) return;
    stopAnimationTimer();
    state.animation.isPlaying = false;
    state.animation.isPaused = true;
    updateAnimationControlsUI();
  }

  function resetAnimationToFull() {
    stopAnimationTimer();
    state.animation.isPlaying = false;
    state.animation.isPaused = false;
    state.animation.currentIndex = 0;

    if (state.result) {
      renderChart(state.result.sequence.length);
      highlightActiveSequenceToken(null);
    }
    updateAnimationControlsUI();
  }

  /* ========================================================================
     6. MAIN WORKFLOW HANDLERS & EVENT LISTENERS
     ======================================================================== */

  function setFeedback(message, type = 'info') {
    dom.feedback.textContent = message;
    dom.feedback.className = 'feedback-message';
    dom.input.classList.remove('input-error');

    if (type === 'error') {
      dom.feedback.classList.add('error');
      dom.input.classList.add('input-error');
    } else if (type === 'warning') {
      dom.feedback.classList.add('warning');
    }
  }

  function executeCalculation(rawInput) {
    const validation = parsePositiveBigInt(rawInput);
    if (!validation.valid) {
      setFeedback(validation.error, 'error');
      return;
    }

    try {
      stopAnimationTimer();
      const result = computeCollatzSequence(validation.value);
      state.result = result;

      // Determine safe axis scaling mode
      if (result.requiresScaledAxis) {
        state.forcedLogScale = true;
        state.useLogScale = true;
        setFeedback(
          'Values exceed Number.MAX_SAFE_INTEGER; graph switched to Log₁₀ scale while preserving exact BigInt values.',
          'warning'
        );
      } else {
        state.forcedLogScale = false;
        setFeedback(
          `Converged to 1 in ${result.steps.toLocaleString()} steps.`,
          'info'
        );
      }

      updateStatisticsUI(result);
      updateScaleControlsUI();
      renderSequenceList(result);

      resetAnimationToFull();
    } catch (err) {
      setFeedback(err.message || 'An unexpected calculation error occurred.', 'error');
    }
  }

  function handleReset() {
    dom.input.value = '27';
    state.useLogScale = false;
    executeCalculation('27');
  }

  // Speed slider conversion: 1 (slow: 450ms) -> 100 (fast: 10ms)
  function updateSpeedFromSlider() {
    const val = Number(dom.speedSlider.value);
    const delay = Math.round(460 - val * 4.5);
    state.animation.delayMs = Math.max(10, delay);
    dom.speedLabel.textContent = `${state.animation.delayMs} ms/step`;
  }

  // Event Bindings
  dom.calcBtn.addEventListener('click', () => executeCalculation(dom.input.value));

  dom.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      executeCalculation(dom.input.value);
    }
  });

  dom.resetBtn.addEventListener('click', handleReset);

  dom.presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const presetVal = btn.dataset.preset;
      dom.input.value = presetVal;
      executeCalculation(presetVal);
    });
  });

  dom.scaleToggleBtn.addEventListener('click', () => {
    if (state.forcedLogScale) return;
    state.useLogScale = !state.useLogScale;
    updateScaleControlsUI();
    if (state.animation.isPlaying || state.animation.isPaused) {
      renderChart(state.animation.currentIndex + 1);
    } else {
      renderChart();
    }
  });

  dom.animPlayBtn.addEventListener('click', startOrResumeAnimation);
  dom.animPauseBtn.addEventListener('click', pauseAnimation);
  dom.animResetBtn.addEventListener('click', resetAnimationToFull);

  dom.speedSlider.addEventListener('input', updateSpeedFromSlider);

  dom.copySeqBtn.addEventListener('click', async () => {
    if (!state.result) return;
    const text = state.result.sequence.map((item) => item.value.toString()).join(' → ');
    try {
      await navigator.clipboard.writeText(text);
      const originalText = dom.copySeqBtn.textContent;
      dom.copySeqBtn.textContent = 'Copied!';
      setTimeout(() => {
        dom.copySeqBtn.textContent = originalText;
      }, 1600);
    } catch {
      setFeedback('Unable to access clipboard automatically.', 'warning');
    }
  });

  // Initialize application on page load
  updateSpeedFromSlider();
  executeCalculation(dom.input.value);
})();