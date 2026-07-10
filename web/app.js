// ============================================
// Player Similarity Engine — Application Controller
// ============================================

'use strict';

// ---------- Constants ----------
const POSITION_COLORS = {
  FW: '#C05C3C',
  MF: '#1B4332',
  DF: '#D4A843',
  GK: '#6B6560',
};

const POSITION_COLORS_LIGHT = {
  FW: 'rgba(192, 92, 60, 0.15)',
  MF: 'rgba(27, 67, 50, 0.15)',
  DF: 'rgba(212, 168, 67, 0.15)',
  GK: 'rgba(107, 101, 96, 0.15)',
};

const RADAR_LABELS = ['Shooting', 'Creativity', 'Passing', 'Defending', 'Possession', 'Physical'];

const COUNTRY_FLAGS = {
  'Argentina': '\u{1F1E6}\u{1F1F7}',
  'France': '\u{1F1EB}\u{1F1F7}',
  'Croatia': '\u{1F1ED}\u{1F1F7}',
  'Morocco': '\u{1F1F2}\u{1F1E6}',
  'England': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  'Portugal': '\u{1F1F5}\u{1F1F9}',
  'Brazil': '\u{1F1E7}\u{1F1F7}',
  'Spain': '\u{1F1EA}\u{1F1F8}',
  'Netherlands': '\u{1F1F3}\u{1F1F1}',
  'Belgium': '\u{1F1E7}\u{1F1EA}',
  'Germany': '\u{1F1E9}\u{1F1EA}',
  'Uruguay': '\u{1F1FA}\u{1F1FE}',
  'Colombia': '\u{1F1E8}\u{1F1F4}',
  'Italy': '\u{1F1EE}\u{1F1F9}',
  'USA': '\u{1F1FA}\u{1F1F8}',
  'Mexico': '\u{1F1F2}\u{1F1FD}',
  'Japan': '\u{1F1EF}\u{1F1F5}',
  'South Korea': '\u{1F1F0}\u{1F1F7}',
  'Senegal': '\u{1F1F8}\u{1F1F3}',
  'Ghana': '\u{1F1EC}\u{1F1ED}',
  'Switzerland': '\u{1F1E8}\u{1F1ED}',
  'Poland': '\u{1F1F5}\u{1F1F1}',
  'Australia': '\u{1F1E6}\u{1F1FA}',
  'Costa Rica': '\u{1F1E8}\u{1F1F7}',
  'Chile': '\u{1F1E8}\u{1F1F1}',
  'Nigeria': '\u{1F1F3}\u{1F1EC}',
  'Algeria': '\u{1F1E9}\u{1F1FF}',
  'Cameroon': '\u{1F1E8}\u{1F1F2}',
  'Ecuador': '\u{1F1EA}\u{1F1E8}',
  'Iran': '\u{1F1EE}\u{1F1F7}',
  'Tunisia': '\u{1F1F9}\u{1F1F3}',
  'Saudi Arabia': '\u{1F1F8}\u{1F1E6}',
  'Denmark': '\u{1F1E9}\u{1F1F0}',
  'Serbia': '\u{1F1F7}\u{1F1F8}',
  'Canada': '\u{1F1E8}\u{1F1E6}',
  'Wales': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
  'Qatar': '\u{1F1F6}\u{1F1E6}',
  'Honduras': '\u{1F1ED}\u{1F1F3}',
  'Bosnia and Herzegovina': '\u{1F1E7}\u{1F1E6}',
  'Greece': '\u{1F1EC}\u{1F1F7}',
  'Ivory Coast': '\u{1F1E8}\u{1F1EE}',
  'Panama': '\u{1F1F5}\u{1F1E6}',
  'Russia': '\u{1F1F7}\u{1F1FA}',
  'Sweden': '\u{1F1F8}\u{1F1EA}',
  'Peru': '\u{1F1F5}\u{1F1EA}',
  'Egypt': '\u{1F1EA}\u{1F1EC}',
};

// ---------- State ----------
const state = {
  allPlayers: [],
  filteredPlayers: [],
  selectedPlayer: null,
  comparedPlayer: null,
  activeFilters: { tournament: 'all', position: 'all' },
  searchQuery: '',
  highlightedIndex: -1,
  activeRegion: null,
};

// ---------- Chart Instances ----------
let scatterChart = null;
let radarChart = null;

// ---------- DOM Helper ----------
const $ = (id) => document.getElementById(id);

const dom = {};

// ---------- Utility Functions ----------

function slugify(name, year) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') + '-' + year;
}

function getPositionColor(position) {
  return POSITION_COLORS[position] || POSITION_COLORS.MF;
}

function getPositionColorLight(position) {
  return POSITION_COLORS_LIGHT[position] || POSITION_COLORS_LIGHT.MF;
}

function getCountryFlag(country) {
  return COUNTRY_FLAGS[country] || '\u{1F3F3}\u{FE0F}';
}

function formatStat(key, value) {
  if (value === undefined || value === null) return '\u2014';
  if (key.includes('pct')) return `${value.toFixed(1)}%`;
  if (key.includes('minutes')) return value.toLocaleString();
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function getTournamentYear(tournament) {
  const match = tournament.match(/\d{4}/);
  return match ? match[0] : '';
}

function isPlayerInRegion(player, region) {
  const x = player.pca_x;
  const y = player.pca_y;
  switch (region) {
    case 'creative':
      return x > 0.8 && y > -1.0;
    case 'clinical':
      return x > 0.8 && y <= -1.0;
    case 'tempo':
      return x <= 0.8 && y > -1.5 && player.position !== 'DF';
    case 'defensive':
      return player.position === 'DF' || x <= -2.0;
    default:
      return true;
  }
}

// ---------- Data Loading ----------

async function loadPlayerData() {
  showLoadingSkeleton();
  try {
    const response = await fetch('data/players.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.allPlayers = data.players;
    state.filteredPlayers = [...data.players];
    hideLoadingSkeleton();
    initializeApp();
  } catch (error) {
    console.error('Failed to load player data:', error);
    hideLoadingSkeleton();
    showErrorState();
  }
}

function showLoadingSkeleton() {
  $('loading-skeleton').style.display = 'block';
  const mainEl = $('main-content');
  if (mainEl) mainEl.style.display = 'none';
}

function hideLoadingSkeleton() {
  $('loading-skeleton').style.display = 'none';
}

function showErrorState() {
  $('error-state').style.display = 'block';
}

// ---------- Initialization ----------

function initializeApp() {
  cacheDOMReferences();
  const mainEl = $('main-content');
  if (mainEl) mainEl.style.display = 'block';
  setupEventListeners();
  applyFilters();
  createScatterChart();
  triggerEntryAnimations();
}

function cacheDOMReferences() {
  dom.searchInput = $('search-input');
  dom.searchDropdown = $('search-dropdown');
  dom.searchContainer = $('search-container');
  dom.scatterChart = $('scatter-chart');
  dom.radarChart = $('radar-chart');
  dom.playerPanel = $('player-panel');
  dom.emptyState = $('empty-state');
  dom.selectedSection = $('selected-player-section');
  dom.playerName = $('player-name');
  dom.playerTeam = $('player-team');
  dom.playerPositionBadge = $('player-position-badge');
  dom.playerTournament = $('player-tournament');
  dom.statGoals = $('stat-goals');
  dom.statAssists = $('stat-assists');
  dom.statMinutes = $('stat-minutes');
  dom.statMatches = $('stat-matches');
  dom.similarList = $('similar-players-list');
}

// ---------- Entry Animations ----------

function triggerEntryAnimations() {
  const animElements = document.querySelectorAll('[data-animate]');
  animElements.forEach((el) => {
    el.style.opacity = '0';
    const delay = parseInt(el.dataset.animate, 10) * 100;
    setTimeout(() => {
      el.style.animation = `fadeSlideUp 700ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms forwards`;
    }, 50);
  });
}

// ---------- Event Listeners ----------

function setupEventListeners() {
  const debouncedSearch = debounce(handleSearch, 200);

  dom.searchInput.addEventListener('input', debouncedSearch);
  dom.searchInput.addEventListener('keydown', handleSearchKeydown);
  dom.searchInput.addEventListener('focus', () => {
    if (dom.searchInput.value.trim().length > 0) {
      handleSearch();
    }
  });

  document.addEventListener('click', (e) => {
    if (!dom.searchContainer.contains(e.target)) {
      closeSearchDropdown();
    }
  });

  document.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', handleFilterClick);
  });

  // Role Explorer click handlers
  document.querySelectorAll('.role-card').forEach((card) => {
    card.addEventListener('click', () => {
      const role = card.dataset.role;
      if (state.activeRegion === role) {
        state.activeRegion = null;
        card.classList.remove('active');
      } else {
        state.activeRegion = role;
        document.querySelectorAll('.role-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
      }
      updateScatterChart();
    });
  });

  // Close selected player panel button click handler
  const closeBtn = $('close-panel-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', deselectPlayer);
  }
}

// ---------- Filters ----------

function handleFilterClick(e) {
  const pill = e.currentTarget;
  const filterType = pill.dataset.filter;
  const value = pill.dataset.value;

  const group = pill.closest('.filter-group');
  group.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
  pill.classList.add('active');

  state.activeFilters[filterType] = value;
  applyFilters();
  updateScatterChart();

  if (state.selectedPlayer) {
    const stillVisible = state.filteredPlayers.some((p) => p.id === state.selectedPlayer.id);
    if (!stillVisible) {
      deselectPlayer();
    }
  }
}

function applyFilters() {
  state.filteredPlayers = state.allPlayers.filter((player) => {
    const tournamentMatch =
      state.activeFilters.tournament === 'all' ||
      player.tournament.includes(state.activeFilters.tournament);
    const positionMatch =
      state.activeFilters.position === 'all' ||
      player.position === state.activeFilters.position;
    return tournamentMatch && positionMatch;
  });
}

// ---------- Search & Autocomplete ----------

function handleSearch() {
  const query = dom.searchInput.value.trim().toLowerCase();
  state.searchQuery = query;
  state.highlightedIndex = -1;

  if (query.length < 1) {
    closeSearchDropdown();
    return;
  }

  const results = state.filteredPlayers
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.team.toLowerCase().includes(query)
    )
    .slice(0, 8);

  renderSearchResults(results);
}

function renderSearchResults(results) {
  const dropdown = dom.searchDropdown;

  if (results.length === 0) {
    dropdown.innerHTML = '<div class="search-no-results">No players found matching your search.</div>';
    dropdown.classList.add('visible');
    return;
  }

  dropdown.innerHTML = results
    .map(
      (player, i) => `
    <div class="search-result" role="option" data-index="${i}" data-player-id="${player.id}">
      <div>
        <span class="search-result-name">${highlightMatch(player.name, state.searchQuery)}</span>
        <span class="search-result-meta">${getCountryFlag(player.team)} ${player.team}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="position-badge ${player.position.toLowerCase()}">${player.position}</span>
        <span class="search-result-meta">${getTournamentYear(player.tournament)}</span>
      </div>
    </div>
  `
    )
    .join('');

  dropdown.querySelectorAll('.search-result').forEach((el) => {
    el.addEventListener('click', () => {
      const playerId = el.dataset.playerId;
      const player = state.allPlayers.find((p) => p.id === playerId);
      if (player) selectPlayer(player);
      closeSearchDropdown();
      dom.searchInput.value = '';
    });
  });

  dropdown.classList.add('visible');
}

function highlightMatch(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(regex, '<strong>$1</strong>');
}

function handleSearchKeydown(e) {
  const dropdown = dom.searchDropdown;
  const items = dropdown.querySelectorAll('.search-result');
  if (!dropdown.classList.contains('visible')) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.highlightedIndex = Math.min(state.highlightedIndex + 1, items.length - 1);
    updateHighlightedResult(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.highlightedIndex = Math.max(state.highlightedIndex - 1, 0);
    updateHighlightedResult(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (state.highlightedIndex >= 0 && items[state.highlightedIndex]) {
      items[state.highlightedIndex].click();
    }
  } else if (e.key === 'Escape') {
    closeSearchDropdown();
    dom.searchInput.blur();
  }
}

function updateHighlightedResult(items) {
  items.forEach((item, i) => {
    item.classList.toggle('highlighted', i === state.highlightedIndex);
  });
  if (items[state.highlightedIndex]) {
    items[state.highlightedIndex].scrollIntoView({ block: 'nearest' });
  }
}

function closeSearchDropdown() {
  dom.searchDropdown.classList.remove('visible');
  state.highlightedIndex = -1;
}

// ---------- Player Selection ----------

function selectPlayer(player) {
  state.selectedPlayer = player;
  state.comparedPlayer = null;
  state.activeRegion = null;
  document.querySelectorAll('.role-card').forEach((c) => c.classList.remove('active'));

  dom.emptyState.style.display = 'none';
  dom.selectedSection.style.display = 'block';

  dom.playerName.textContent = player.name;
  dom.playerTeam.innerHTML = `${getCountryFlag(player.team)} ${player.team}`;
  dom.playerPositionBadge.textContent = player.position;
  dom.playerPositionBadge.className = `position-badge ${player.position.toLowerCase()}`;
  dom.playerTournament.textContent = player.tournament;

  const stats = player.stats_per90;
  dom.statGoals.textContent = formatStat('goals', stats.goals_per90);
  dom.statAssists.textContent = formatStat('assists', stats.assists_per90);
  dom.statMinutes.textContent = formatStat('minutes_played', player.minutes_played);
  dom.statMatches.textContent = player.matches_played;

  const card = $('selected-player-card');
  card.style.animation = 'none';
  void card.offsetHeight;
  card.style.animation = 'fadeSlideUp 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards';

  updateRadarChart(player);
  updateScatterChart();
  renderSimilarPlayers(player);

  if (window.innerWidth <= 1024) {
    dom.selectedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function deselectPlayer() {
  state.selectedPlayer = null;
  state.comparedPlayer = null;
  state.activeRegion = null;
  document.querySelectorAll('.role-card').forEach((c) => c.classList.remove('active'));
  
  dom.emptyState.style.display = 'flex';
  dom.selectedSection.style.display = 'none';
  if (radarChart) {
    radarChart.destroy();
    radarChart = null;
  }
  updateScatterChart();
}

// ---------- Similar Players ----------

function renderSimilarPlayers(player) {
  const list = dom.similarList;

  if (!player.similar_players || player.similar_players.length === 0) {
    list.innerHTML = '<p class="search-no-results">No similar players found.</p>';
    return;
  }

  list.innerHTML = player.similar_players
    .map(
      (sp, i) => `
    <div class="similar-card" data-similar-id="${sp.id}" data-index="${i}" style="animation: fadeSlideUp 400ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 80}ms forwards; opacity: 0;">
      <div class="similar-card-info">
        <div class="similar-card-name">${sp.name}</div>
        <div class="similar-card-meta">${getCountryFlag(sp.team)} ${sp.team} \u00B7 ${sp.position} \u00B7 ${getTournamentYear(sp.tournament)}</div>
      </div>
      <span class="similarity-badge">${Math.round(sp.similarity * 100)}% Match</span>
    </div>
  `
    )
    .join('');

  list.querySelectorAll('.similar-card').forEach((card) => {
    card.addEventListener('click', () => {
      const similarId = card.dataset.similarId;
      const similarIndex = parseInt(card.dataset.index, 10);
      const similarPlayer = player.similar_players[similarIndex];

      if (state.comparedPlayer && state.comparedPlayer.id === similarId) {
        state.comparedPlayer = null;
        card.classList.remove('active');
        updateRadarChart(player);
        updateScatterChart();
      } else {
        state.comparedPlayer = similarPlayer;
        list.querySelectorAll('.similar-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        updateRadarChart(player, similarPlayer);
        updateScatterChart();
      }
    });
  });
}

// ---------- Scatter Chart ----------

function createScatterChart() {
  const ctx = dom.scatterChart.getContext('2d');
  const datasets = buildScatterDatasets();

  scatterChart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 16 / 10,
      interaction: {
        mode: 'nearest',
        intersect: true,
      },
      animation: {
        duration: 600,
        easing: 'easeOutQuart',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'nearest',
          intersect: true,
          backgroundColor: '#1A1A1A',
          titleColor: '#FAF8F5',
          bodyColor: '#FAF8F5',
          titleFont: { family: 'DM Sans', size: 13, weight: '600' },
          bodyFont: { family: 'DM Sans', size: 11 },
          padding: { x: 12, y: 8 },
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            title: (items) => {
              if (items.length === 0) return '';
              const player = items[0].raw.player;
              return player ? player.name : '';
            },
            label: (item) => {
              const player = item.raw.player;
              if (!player) return '';
              return `${player.team} \u00B7 ${player.position} \u00B7 ${getTournamentYear(player.tournament)}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Principal Component 1',
            font: { family: 'DM Sans', size: 12, weight: '500' },
            color: '#9A948E',
          },
          grid: {
            color: 'rgba(232, 226, 218, 0.5)',
          },
          border: {
            display: false,
          },
          ticks: {
            font: { family: 'DM Sans', size: 10 },
            color: '#9A948E',
          },
        },
        y: {
          title: {
            display: true,
            text: 'Principal Component 2',
            font: { family: 'DM Sans', size: 12, weight: '500' },
            color: '#9A948E',
          },
          grid: {
            color: 'rgba(232, 226, 218, 0.5)',
          },
          border: {
            display: false,
          },
          ticks: {
            font: { family: 'DM Sans', size: 10 },
            color: '#9A948E',
          },
        },
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const element = elements[0];
          const dataset = scatterChart.data.datasets[element.datasetIndex];
          const pointData = dataset.data[element.index];
          if (pointData && pointData.player) {
            selectPlayer(pointData.player);
          }
        }
      },
      onHover: (event, elements) => {
        const canvas = event.native ? event.native.target : event.chart.canvas;
        canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
    },
  });
}

function buildScatterDatasets() {
  const positions = ['FW', 'MF', 'DF', 'GK'];
  const datasets = [];

  positions.forEach((pos) => {
    const players = state.filteredPlayers.filter((p) => p.position === pos);
    if (players.length === 0) return;

    datasets.push({
      label: pos,
      data: players.map((p) => ({
        x: p.pca_x,
        y: p.pca_y,
        player: p,
      })),
      backgroundColor: players.map((p) => {
        const color = getPositionColor(pos);
        
        // If there's an active region filter
        if (state.activeRegion) {
          if (isPlayerInRegion(p, state.activeRegion)) {
            return color;
          }
          return color + '15'; // Very faded
        }
        
        if (state.selectedPlayer) {
          if (p.id === state.selectedPlayer.id) return color;
          if (state.selectedPlayer.similar_players &&
              state.selectedPlayer.similar_players.some((sp) => sp.id === p.id)) {
            return color;
          }
          return color + '40';
        }
        return color;
      }),
      borderColor: players.map((p) => getPointBorderColor(p)),
      pointRadius: players.map((p) => getPointRadius(p)),
      pointHoverRadius: 10,
      pointBorderWidth: players.map((p) => getPointBorderWidth(p)),
    });
  });

  if (state.selectedPlayer && state.selectedPlayer.similar_players) {
    const lineData = [];
    const selectedPoint = { x: state.selectedPlayer.pca_x, y: state.selectedPlayer.pca_y };

    state.selectedPlayer.similar_players.forEach((sp) => {
      const fullPlayer = state.allPlayers.find((p) => p.id === sp.id);
      if (fullPlayer) {
        lineData.push({ x: selectedPoint.x, y: selectedPoint.y });
        lineData.push({ x: fullPlayer.pca_x, y: fullPlayer.pca_y });
        lineData.push({ x: NaN, y: NaN });
      }
    });

    if (lineData.length > 0) {
      datasets.push({
        label: 'Connections',
        data: lineData,
        showLine: true,
        fill: false,
        borderColor: 'rgba(27, 67, 50, 0.18)',
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
      });
    }
  }

  return datasets;
}

function getPointRadius(player) {
  if (state.activeRegion) {
    if (isPlayerInRegion(player, state.activeRegion)) return 7;
    return 3;
  }
  if (state.selectedPlayer && player.id === state.selectedPlayer.id) return 12;
  if (state.comparedPlayer && player.id === state.comparedPlayer.id) return 10;
  if (
    state.selectedPlayer &&
    state.selectedPlayer.similar_players &&
    state.selectedPlayer.similar_players.some((sp) => sp.id === player.id)
  ) {
    return 8;
  }
  return 6;
}

function getPointBorderWidth(player) {
  if (state.selectedPlayer && player.id === state.selectedPlayer.id) return 3;
  if (state.comparedPlayer && player.id === state.comparedPlayer.id) return 2;
  return 0;
}

function getPointBorderColor(player) {
  if (state.selectedPlayer && player.id === state.selectedPlayer.id) return '#1A1A1A';
  if (state.comparedPlayer && player.id === state.comparedPlayer.id) return '#1B4332';
  return 'transparent';
}

function updateScatterChart() {
  if (!scatterChart) return;
  scatterChart.data.datasets = buildScatterDatasets();
  scatterChart.update('default');
}

// ---------- Radar Chart ----------

function updateRadarChart(player, comparedPlayer = null) {
  const ctx = dom.radarChart.getContext('2d');

  if (radarChart) radarChart.destroy();

  const playerColor = getPositionColor(player.position);
  const datasets = [
    {
      label: player.name,
      data: RADAR_LABELS.map((label) => player.radar[label] || 0),
      backgroundColor: playerColor + '22',
      borderColor: playerColor,
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: playerColor,
      pointBorderColor: '#FAF8F5',
      pointBorderWidth: 2,
      fill: true,
    },
  ];

  if (comparedPlayer && comparedPlayer.radar) {
    datasets.push({
      label: comparedPlayer.name,
      data: RADAR_LABELS.map((label) => comparedPlayer.radar[label] || 0),
      backgroundColor: 'rgba(212, 168, 67, 0.12)',
      borderColor: '#D4A843',
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: '#D4A843',
      pointBorderColor: '#FAF8F5',
      pointBorderWidth: 2,
      borderDash: [4, 4],
      fill: true,
    });
  }

  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: RADAR_LABELS,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: {
        duration: 600,
        easing: 'easeOutQuart',
      },
      plugins: {
        legend: {
          display: comparedPlayer !== null,
          position: 'bottom',
          labels: {
            font: { family: 'DM Sans', size: 11 },
            color: '#6B6560',
            boxWidth: 12,
            padding: 16,
            usePointStyle: true,
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: '#1A1A1A',
          titleColor: '#FAF8F5',
          bodyColor: '#FAF8F5',
          titleFont: { family: 'DM Sans', size: 12 },
          bodyFont: { family: 'DM Sans', size: 11 },
          padding: { x: 10, y: 6 },
          cornerRadius: 6,
          callbacks: {
            label: (item) => {
              return `${item.dataset.label}: ${item.raw}`;
            },
          },
        },
      },
      scales: {
        r: {
          beginAtZero: true,
          min: 0,
          max: 100,
          ticks: {
            display: false,
            stepSize: 20,
          },
          grid: {
            color: 'rgba(232, 226, 218, 0.6)',
            lineWidth: 1,
          },
          angleLines: {
            color: 'rgba(232, 226, 218, 0.4)',
            lineWidth: 1,
          },
          pointLabels: {
            font: { family: 'DM Sans', size: 11, weight: '500' },
            color: '#6B6560',
            padding: 8,
          },
        },
      },
    },
  });
}

// ---------- Bootstrap ----------

document.addEventListener('DOMContentLoaded', loadPlayerData);
