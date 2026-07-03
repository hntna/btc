/**
 * Crypto Volume Dashboard Application Logic
 * Integrates with Binance REST & WebSocket APIs
 */

let currentSymbol = 'ETHUSDT';
let socket = null;

// Historical Kline data arrays
let candles1h = [];
let candles4h = [];

// Filtered day of week candles (Monday to Sunday)
let dayData1h = Array(7).fill(null);
let dayData4h = Array(7).fill(null);

// Filtered week-over-week candles (same weekday and hour for past weeks)
let weeksData1h = [];
let weeksData4h = [];

// Chart.js Instances
let chart1h = null;
let chart4h = null;
let chart1hWeeks = null;
let chart4hWeeks = null;

// Countdown Target Timestamps (ms)
let closeTime1h = 0;
let closeTime4h = 0;

// Countdown Interval IDs
let timerInterval1h = null;
let timerInterval4h = null;

// Helper: Convert JS Day (0 = Sun, 1 = Mon, ..., 6 = Sat) to Monday-First Index (0 = Mon, ..., 6 = Sun)
function getMondayFirstIndex(jsDay) {
  return jsDay === 0 ? 6 : jsDay - 1;
}

// Helper: Map Monday-First Index back to Vietnamese day names
const dayNamesVi = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];

// Helper: Format large numbers to human readable format (e.g. 1.2M, 450K)
function formatLargeNumber(num) {
  if (num >= 1e6) {
    return (num / 1e6).toFixed(2) + 'M';
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(2) + 'K';
  }
  return num.toFixed(2);
}

// Helper: Format currency (USDT)
function formatUSDT(num) {
  if (num >= 1e6) {
    return '$' + (num / 1e6).toFixed(2) + 'M';
  } else if (num >= 1e3) {
    return '$' + (num / 1e3).toFixed(2) + 'K';
  }
  return '$' + num.toFixed(2);
}

// Helper: Format coin volume
function formatCoinVolume(num, symbol) {
  const coin = symbol.replace('USDT', '');
  return `${formatLargeNumber(num)} ${coin}`;
}

// Update WS status badge
function updateStatusBadge(status, text) {
  const dot = document.getElementById('status-dot');
  const textEl = document.getElementById('status-text');
  
  dot.className = 'status-dot';
  dot.classList.add(status);
  textEl.innerText = text;
}

// Fetch 24h Ticker Information (to initialize price change percentage)
async function fetchTickerInfo(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    const data = await res.json();
    updateTickerUI(data.lastPrice, data.priceChangePercent, symbol);
  } catch (err) {
    console.error('Lỗi khi tải thông tin ticker 24h:', err);
  }
}

// Update Price and Ticker details in the UI
function updateTickerUI(priceStr, percentStr, symbol) {
  const priceEl = document.getElementById('ticker-price');
  const changeEl = document.getElementById('ticker-change');
  const changeValEl = document.getElementById('ticker-change-val');
  const changeIconEl = document.getElementById('ticker-change-icon');
  const symbolEl = document.getElementById('ticker-symbol');
  
  const price = parseFloat(priceStr);
  const percent = parseFloat(percentStr);
  const coin = symbol.replace('USDT', '');
  
  symbolEl.innerText = `${coin}/USDT`;
  priceEl.innerText = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  changeValEl.innerText = `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
  
  if (percent >= 0) {
    changeEl.className = 'price-change up';
    changeIconEl.className = 'fa-solid fa-caret-up';
  } else {
    changeEl.className = 'price-change down';
    changeIconEl.className = 'fa-solid fa-caret-down';
  }
}

// Fetch historical Klines from Binance API
async function fetchHistoricalKlines(symbol) {
  try {
    // 1H: Limit 800 candles (about 33 days) to cover the last 4 weeks of the same weekday/hour
    const res1h = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=800`);
    candles1h = await res1h.json();
    
    // 4H: Limit 200 candles (about 33 days)
    const res4h = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=200`);
    candles4h = await res4h.json();
    
    processHistoricalData();
  } catch (err) {
    console.error('Lỗi khi tải dữ liệu lịch sử klines:', err);
    alert('Không thể kết nối đến API Binance để tải dữ liệu lịch sử. Vui lòng tải lại trang.');
  }
}

// Process data to find corresponding hour candles for each day of the week
function processHistoricalData() {
  if (candles1h.length === 0 || candles4h.length === 0) return;
  
  // --- 1. Process 1-Hour Charts ---
  const latestKline1h = candles1h[candles1h.length - 1];
  const targetHour1h = new Date(latestKline1h[0]).getHours();
  const targetDayOfWeek1h = new Date(latestKline1h[0]).getDay();
  closeTime1h = latestKline1h[6];
  
  // Set subtitle with comparative hour
  const startHourStr = String(targetHour1h).padStart(2, '0');
  const endHourStr = String((targetHour1h + 1) % 24).padStart(2, '0');
  document.getElementById('subtitle-1h').innerText = `So sánh volume trong khung giờ ${startHourStr}:00 - ${endHourStr}:00 (Giờ địa phương) của các ngày`;
  document.getElementById('subtitle-1h-weeks').innerText = `So sánh volume ngày ${dayNamesVi[getMondayFirstIndex(targetDayOfWeek1h)]} khung ${startHourStr}:00 - ${endHourStr}:00 giữa các tuần`;
  
  // A. Day of Week Chart
  dayData1h = Array(7).fill(null);
  for (let i = candles1h.length - 1; i >= 0; i--) {
    const k = candles1h[i];
    const date = new Date(k[0]);
    if (date.getHours() === targetHour1h) {
      const idx = getMondayFirstIndex(date.getDay());
      if (dayData1h[idx] === null) {
        const isLive = (i === candles1h.length - 1);
        dayData1h[idx] = {
          dateStr: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
          volume: parseFloat(k[5]),
          quoteVolume: parseFloat(k[7]),
          isLive: isLive,
          openTime: k[0],
          closeTime: k[6]
        };
      }
    }
  }

  // B. Week-over-Week Chart (same weekday and hour)
  const matches1h = [];
  for (let i = candles1h.length - 1; i >= 0; i--) {
    const k = candles1h[i];
    const date = new Date(k[0]);
    if (date.getHours() === targetHour1h && date.getDay() === targetDayOfWeek1h) {
      const isLive = (i === candles1h.length - 1);
      matches1h.push({
        dateStr: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
        volume: parseFloat(k[5]),
        quoteVolume: parseFloat(k[7]),
        isLive: isLive,
        openTime: k[0],
        closeTime: k[6]
      });
      if (matches1h.length === 5) break; // Current week + 4 past weeks
    }
  }
  
  // Format labels and order chronologically (oldest to newest)
  weeksData1h = matches1h.reverse().map((item, idx, arr) => {
    const dist = (arr.length - 1) - idx;
    let label = '';
    if (dist === 0) label = 'Tuần này (Hiện tại)';
    else if (dist === 1) label = 'Tuần trước';
    else label = `${dist} tuần trước`;
    return { ...item, label };
  });
  
  // --- 2. Process 4-Hour Charts ---
  const latestKline4h = candles4h[candles4h.length - 1];
  const targetHour4h = new Date(latestKline4h[0]).getHours();
  const targetDayOfWeek4h = new Date(latestKline4h[0]).getDay();
  closeTime4h = latestKline4h[6];
  
  // Show 4H frame hours range
  const startHour4hStr = String(targetHour4h).padStart(2, '0');
  const endHour4hStr = String((targetHour4h + 4) % 24).padStart(2, '0');
  document.getElementById('subtitle-4h').innerText = `So sánh volume trong khung giờ ${startHour4hStr}:00 - ${endHour4hStr}:00 (Giờ địa phương) của các ngày`;
  document.getElementById('subtitle-4h-weeks').innerText = `So sánh volume ngày ${dayNamesVi[getMondayFirstIndex(targetDayOfWeek4h)]} khung ${startHour4hStr}:00 - ${endHour4hStr}:00 giữa các tuần`;
  
  // A. Day of Week Chart
  dayData4h = Array(7).fill(null);
  for (let i = candles4h.length - 1; i >= 0; i--) {
    const k = candles4h[i];
    const date = new Date(k[0]);
    if (date.getHours() === targetHour4h) {
      const idx = getMondayFirstIndex(date.getDay());
      if (dayData4h[idx] === null) {
        const isLive = (i === candles4h.length - 1);
        dayData4h[idx] = {
          dateStr: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
          volume: parseFloat(k[5]),
          quoteVolume: parseFloat(k[7]),
          isLive: isLive,
          openTime: k[0],
          closeTime: k[6]
        };
      }
    }
  }

  // B. Week-over-Week Chart (same weekday and hour)
  const matches4h = [];
  for (let i = candles4h.length - 1; i >= 0; i--) {
    const k = candles4h[i];
    const date = new Date(k[0]);
    if (date.getHours() === targetHour4h && date.getDay() === targetDayOfWeek4h) {
      const isLive = (i === candles4h.length - 1);
      matches4h.push({
        dateStr: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
        volume: parseFloat(k[5]),
        quoteVolume: parseFloat(k[7]),
        isLive: isLive,
        openTime: k[0],
        closeTime: k[6]
      });
      if (matches4h.length === 5) break;
    }
  }
  
  weeksData4h = matches4h.reverse().map((item, idx, arr) => {
    const dist = (arr.length - 1) - idx;
    let label = '';
    if (dist === 0) label = 'Tuần này (Hiện tại)';
    else if (dist === 1) label = 'Tuần trước';
    else label = `${dist} tuần trước`;
    return { ...item, label };
  });
  
  // Render / Update Charts & Stats
  updateStatsAndCharts();
  
  // Start Countdowns
  startTimer1h();
  startTimer4h();
}

// Compute metrics (average volume, comparison percentage) and render charts
function updateStatsAndCharts() {
  const coin = currentSymbol.replace('USDT', '');

  // --- 1H ---
  // A. Day of week
  const liveCandle1h = dayData1h.find(c => c && c.isLive);
  if (liveCandle1h) {
    const currentVol1h = liveCandle1h.volume;
    document.getElementById('value-current-1h').innerHTML = `${formatLargeNumber(currentVol1h)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
    
    const otherDays1h = dayData1h.filter(c => c && !c.isLive);
    if (otherDays1h.length > 0) {
      const avgVol1h = otherDays1h.reduce((sum, c) => sum + c.volume, 0) / otherDays1h.length;
      document.getElementById('value-avg-1h').innerHTML = `${formatLargeNumber(avgVol1h)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
      
      const pct = (currentVol1h / avgVol1h) * 100;
      const compareEl = document.getElementById('compare-1h');
      compareEl.innerText = `${pct.toFixed(1)}% so với trung bình`;
      compareEl.style.color = pct >= 100 ? 'var(--color-up)' : (pct >= 70 ? '#eab308' : 'var(--text-muted)');
    }
  }

  // B. Weeks
  const liveWeekCandle1h = weeksData1h.find(c => c && c.isLive);
  if (liveWeekCandle1h) {
    const currentVol1hWeeks = liveWeekCandle1h.volume;
    document.getElementById('value-current-1h-weeks').innerHTML = `${formatLargeNumber(currentVol1hWeeks)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
    
    const otherWeeks1h = weeksData1h.filter(c => c && !c.isLive);
    if (otherWeeks1h.length > 0) {
      const avgVol1hWeeks = otherWeeks1h.reduce((sum, c) => sum + c.volume, 0) / otherWeeks1h.length;
      document.getElementById('value-avg-1h-weeks').innerHTML = `${formatLargeNumber(avgVol1hWeeks)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
      
      const pct = (currentVol1hWeeks / avgVol1hWeeks) * 100;
      const compareEl = document.getElementById('compare-1h-weeks');
      compareEl.innerText = `${pct.toFixed(1)}% so với trung bình các tuần trước`;
      compareEl.style.color = pct >= 100 ? 'var(--color-up)' : (pct >= 70 ? '#eab308' : 'var(--text-muted)');
    }
  }
  
  // --- 4H ---
  // A. Day of week
  const liveCandle4h = dayData4h.find(c => c && c.isLive);
  if (liveCandle4h) {
    const currentVol4h = liveCandle4h.volume;
    document.getElementById('value-current-4h').innerHTML = `${formatLargeNumber(currentVol4h)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
    
    const otherDays4h = dayData4h.filter(c => c && !c.isLive);
    if (otherDays4h.length > 0) {
      const avgVol4h = otherDays4h.reduce((sum, c) => sum + c.volume, 0) / otherDays4h.length;
      document.getElementById('value-avg-4h').innerHTML = `${formatLargeNumber(avgVol4h)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
      
      const pct = (currentVol4h / avgVol4h) * 100;
      const compareEl = document.getElementById('compare-4h');
      compareEl.innerText = `${pct.toFixed(1)}% so với trung bình`;
      compareEl.style.color = pct >= 100 ? 'var(--color-up)' : (pct >= 70 ? '#eab308' : 'var(--text-muted)');
    }
  }

  // B. Weeks
  const liveWeekCandle4h = weeksData4h.find(c => c && c.isLive);
  if (liveWeekCandle4h) {
    const currentVol4hWeeks = liveWeekCandle4h.volume;
    document.getElementById('value-current-4h-weeks').innerHTML = `${formatLargeNumber(currentVol4hWeeks)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
    
    const otherWeeks4h = weeksData4h.filter(c => c && !c.isLive);
    if (otherWeeks4h.length > 0) {
      const avgVol4hWeeks = otherWeeks4h.reduce((sum, c) => sum + c.volume, 0) / otherWeeks4h.length;
      document.getElementById('value-avg-4h-weeks').innerHTML = `${formatLargeNumber(avgVol4hWeeks)} <span style="font-size: 0.875rem; color: var(--text-secondary); font-weight: 500;">${coin}</span>`;
      
      const pct = (currentVol4hWeeks / avgVol4hWeeks) * 100;
      const compareEl = document.getElementById('compare-4h-weeks');
      compareEl.innerText = `${pct.toFixed(1)}% so với trung bình các tuần trước`;
      compareEl.style.color = pct >= 100 ? 'var(--color-up)' : (pct >= 70 ? '#eab308' : 'var(--text-muted)');
    }
  }
  
  // Render charts
  renderChart('chart-1h-canvas', dayData1h, chart1h, (newChart) => { chart1h = newChart; }, '1H Volume theo ngày');
  renderChart('chart-1h-weeks-canvas', weeksData1h, chart1hWeeks, (newChart) => { chart1hWeeks = newChart; }, '1H Volume theo tuần', true);
  
  renderChart('chart-4h-canvas', dayData4h, chart4h, (newChart) => { chart4h = newChart; }, '4H Volume theo ngày');
  renderChart('chart-4h-weeks-canvas', weeksData4h, chart4hWeeks, (newChart) => { chart4hWeeks = newChart; }, '4H Volume theo tuần', true);
}

// Standard helper to render/update a Chart.js bar chart
function renderChart(canvasId, dataset, chartInstance, setChartInstance, labelName, isWeekChart = false) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  
  const labels = dataset.map((c, i) => {
    if (!c) return isWeekChart ? `Tuần ${i}` : dayNamesVi[i];
    if (isWeekChart) {
      return `${c.label} (${c.dateStr})${c.isLive ? ' 🔴' : ''}`;
    }
    const dayName = dayNamesVi[i];
    return `${dayName} (${c.dateStr})${c.isLive ? ' 🔴' : ''}`;
  });
  
  const volumes = dataset.map(c => c ? c.volume : 0);
  const quoteVolumes = dataset.map(c => c ? c.quoteVolume : 0);
  
  // Style properties
  const backgroundColors = dataset.map(c => {
    if (!c) return 'rgba(255, 255, 255, 0.05)';
    return c.isLive 
      ? 'rgba(6, 182, 212, 0.65)'  // Cyan with good opacity for current active bar
      : 'rgba(99, 102, 241, 0.25)'; // Indigo with lower opacity for completed historical bars
  });
  
  const borderColors = dataset.map(c => {
    if (!c) return 'rgba(255, 255, 255, 0.1)';
    return c.isLive 
      ? 'rgba(6, 182, 212, 1)'      // Bright glowing cyan
      : 'rgba(99, 102, 241, 0.7)';    // Solid indigo
  });

  const borderThickness = dataset.map(c => c && c.isLive ? 2.5 : 1.5);
  
  if (chartInstance) {
    // Update existing chart to prevent re-creation flicker
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = volumes;
    chartInstance.data.datasets[0].backgroundColor = backgroundColors;
    chartInstance.data.datasets[0].borderColor = borderColors;
    chartInstance.data.datasets[0].borderWidth = borderThickness;
    
    // Custom reference to quote volume inside the dataset so tooltip can access it
    chartInstance.data.datasets[0].quoteVolumes = quoteVolumes;
    chartInstance.update('none'); // silent update
  } else {
    // Create new chart instance
    const newChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: labelName,
          data: volumes,
          quoteVolumes: quoteVolumes,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: borderThickness,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false // Hide default legend
          },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.95)',
            titleFont: {
              family: "'Outfit', sans-serif",
              size: 14,
              weight: '600'
            },
            bodyFont: {
              family: "'Outfit', sans-serif",
              size: 13
            },
            borderColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            callbacks: {
              label: function(context) {
                const idx = context.dataIndex;
                const baseVal = context.raw;
                const quoteVal = context.dataset.quoteVolumes[idx];
                const coin = currentSymbol.replace('USDT', '');
                
                return [
                  `Volume: ${baseVal.toLocaleString('en-US', {maximumFractionDigits: 2})} ${coin}`,
                  `Giá trị: ${formatUSDT(quoteVal)}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: '#9ca3af',
              font: {
                family: "'Outfit', sans-serif",
                size: 12
              }
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)'
            },
            ticks: {
              color: '#9ca3af',
              font: {
                family: "'Outfit', sans-serif",
                size: 11
              },
              callback: function(value) {
                return formatLargeNumber(value);
              }
            }
          }
        }
      }
    });
    setChartInstance(newChart);
  }
}

// 1H Countdown Timer
function startTimer1h() {
  if (timerInterval1h) clearInterval(timerInterval1h);
  
  const timerEl1 = document.getElementById('timer-1h');
  const timerEl2 = document.getElementById('timer-1h-weeks');
  
  function updateTimer() {
    const now = Date.now();
    const timeLeft = closeTime1h - now;
    
    if (timeLeft <= 0) {
      timerEl1.innerText = '00:00';
      timerEl2.innerText = '00:00';
      clearInterval(timerInterval1h);
      // Wait 3 seconds and refresh data
      setTimeout(() => fetchHistoricalKlines(currentSymbol), 3000);
      return;
    }
    
    const minutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);
    const text = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    timerEl1.innerText = text;
    timerEl2.innerText = text;
  }
  
  updateTimer();
  timerInterval1h = setInterval(updateTimer, 1000);
}

// 4H Countdown Timer
function startTimer4h() {
  if (timerInterval4h) clearInterval(timerInterval4h);
  
  const timerEl1 = document.getElementById('timer-4h');
  const timerEl2 = document.getElementById('timer-4h-weeks');
  
  function updateTimer() {
    const now = Date.now();
    const timeLeft = closeTime4h - now;
    
    if (timeLeft <= 0) {
      timerEl1.innerText = '00:00:00';
      timerEl2.innerText = '00:00:00';
      clearInterval(timerInterval4h);
      setTimeout(() => fetchHistoricalKlines(currentSymbol), 3000);
      return;
    }
    
    const hours = Math.floor(timeLeft / 3600000);
    const minutes = Math.floor((timeLeft % 3600000) / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);
    const text = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    timerEl1.innerText = text;
    timerEl2.innerText = text;
  }
  
  updateTimer();
  timerInterval4h = setInterval(updateTimer, 1000);
}

// Initialize real-time WebSocket connection to Binance
function initWebSocket(symbol) {
  if (socket) {
    socket.close();
  }
  
  updateStatusBadge('connecting', 'Đang kết nối WebSocket...');
  
  // Create combined stream WebSocket url
  const streams = [
    `${symbol.toLowerCase()}@kline_1h`,
    `${symbol.toLowerCase()}@kline_4h`,
    `${symbol.toLowerCase()}@ticker`
  ].join('/');
  
  socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
  
  socket.onopen = () => {
    updateStatusBadge('connected', 'WebSocket Đang Hoạt Động');
  };
  
  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    const stream = payload.stream;
    const data = payload.data;
    
    if (stream.includes('@ticker')) {
      // Real-time price updates (fast ticker)
      updateTickerUI(data.c, data.P, symbol);
    } 
    else if (stream.includes('@kline_1h')) {
      const kline = data.k;
      const klineOpenTime = kline.t;
      closeTime1h = kline.T; // Update closest 1h end timestamp
      
      // Update our stored live kline volume
      const todayIdx = getMondayFirstIndex(new Date(klineOpenTime).getDay());
      
      if (dayData1h[todayIdx] && dayData1h[todayIdx].isLive) {
        dayData1h[todayIdx].volume = parseFloat(kline.v);
        dayData1h[todayIdx].quoteVolume = parseFloat(kline.q);
      }
      
      const liveWeek1h = weeksData1h.find(c => c && c.isLive);
      if (liveWeek1h) {
        liveWeek1h.volume = parseFloat(kline.v);
        liveWeek1h.quoteVolume = parseFloat(kline.q);
      }
      
      // Dynamic UI stats update
      updateStatsAndCharts();
    } 
    else if (stream.includes('@kline_4h')) {
      const kline = data.k;
      const klineOpenTime = kline.t;
      closeTime4h = kline.T; // Update closest 4h end timestamp
      
      const todayIdx = getMondayFirstIndex(new Date(klineOpenTime).getDay());
      
      if (dayData4h[todayIdx] && dayData4h[todayIdx].isLive) {
        dayData4h[todayIdx].volume = parseFloat(kline.v);
        dayData4h[todayIdx].quoteVolume = parseFloat(kline.q);
      }
      
      const liveWeek4h = weeksData4h.find(c => c && c.isLive);
      if (liveWeek4h) {
        liveWeek4h.volume = parseFloat(kline.v);
        liveWeek4h.quoteVolume = parseFloat(kline.q);
      }
      
      updateStatsAndCharts();
    }
  };
  
  socket.onclose = () => {
    updateStatusBadge('disconnected', 'WebSocket Mất Kết Nối. Đang kết nối lại...');
    // Reconnect in 5 seconds
    setTimeout(() => initWebSocket(currentSymbol), 5000);
  };
  
  socket.onerror = (err) => {
    console.error('Lỗi kết nối WebSocket:', err);
    updateStatusBadge('disconnected', 'Lỗi WebSocket');
  };
}

// App Initialization Handler
async function initApp(symbol) {
  currentSymbol = symbol;
  
  // 1. Reset variables
  dayData1h = Array(7).fill(null);
  dayData4h = Array(7).fill(null);
  weeksData1h = [];
  weeksData4h = [];
  
  // 2. Fetch Initial Prices & History
  await fetchTickerInfo(symbol);
  await fetchHistoricalKlines(symbol);
  
  // 3. Start Streaming
  initWebSocket(symbol);
}

// Listen to Symbol Dropdown Switch
document.getElementById('symbol-select').addEventListener('change', (e) => {
  const selectedSymbol = e.target.value;
  initApp(selectedSymbol);
});

// Bootstrap application on page load
window.addEventListener('DOMContentLoaded', () => {
  initApp(currentSymbol);
});
