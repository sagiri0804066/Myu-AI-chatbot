// 全局状态保存列表数据
let currentModels = [];
let currentPresets = [];

// ==========================================
// DOM 元素引用
// ==========================================
const elBaseUrl = document.getElementById('baseurl');
const elApiKey = document.getElementById('apikey');
const elModelSelect = document.getElementById('modelSelect');
const elPresetSelect = document.getElementById('presetSelect');
const connectBtn = document.getElementById('connectBtn');

// 高级面板核心
const settingsPanel = document.getElementById('settingsPanel');
const advancedBtn = document.getElementById('advancedBtn');
const elMaxTokens = document.getElementById('maxTokens');
const elTemperature = document.getElementById('temperature');
const elTopP = document.getElementById('topP');
const elFrequencyPenalty = document.getElementById('frequencyPenalty');
const elPresencePenalty = document.getElementById('presencePenalty');
const elStreamSelect = document.getElementById('streamSelect');

// VLM 专用元素
const elVlmEnabled = document.getElementById('vlmEnabled');
const elVlmConfigGroup = document.getElementById('vlmConfigGroup');
const elVlmBaseUrl = document.getElementById('vlmBaseUrl');
const elVlmApiKey = document.getElementById('vlmApiKey');
const elVlmModel = document.getElementById('vlmModel');

// ==========================================
// 动态滑块数值显示逻辑
// ==========================================
const sliders = ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'];
sliders.forEach(id => {
  const inputEl = document.getElementById(id);
  const displayEl = document.getElementById(`val-${id}`);
  if (inputEl && displayEl) {
    inputEl.addEventListener('input', (e) => {
      displayEl.textContent = parseFloat(e.target.value).toFixed(1);
    });
  }
});

// ==========================================
// 高级设置展开/折叠 & VLM 显示切换
// ==========================================
advancedBtn.onclick = () => {
  settingsPanel.classList.toggle('expanded');
  advancedBtn.classList.toggle('active');
};

// VLM 启用开关监听
if (elVlmEnabled) {
  elVlmEnabled.onchange = () => {
    const isEnabled = elVlmEnabled.value === 'true';
    elVlmConfigGroup.style.display = isEnabled ? 'block' : 'none';
  };
}

// ==========================================
// 1. 初始化页面：请求后端 init 接口
// ==========================================
async function initSettings() {
  try {
    const res = await fetch('/api/settings/init');
    const config = await res.json();

    // 基础配置
    elBaseUrl.value = config.baseurl || '';
    elApiKey.value = config.apikey || '';

    currentModels = config.models || [];
    currentPresets = config.presets || [];

    renderSelect(elModelSelect, currentModels, config.model, '无模型');
    renderSelect(elPresetSelect, currentPresets, config.preset, '无预设');

    // 初始化高级设置
    elMaxTokens.value = config.max_tokens ?? 1024;

    const temp = config.temperature ?? 1.0;
    elTemperature.value = temp;
    document.getElementById('val-temperature').textContent = temp.toFixed(1);

    const topP = config.top_p ?? 1.0;
    elTopP.value = topP;
    document.getElementById('val-topP').textContent = topP.toFixed(1);

    const freq = config.frequency_penalty ?? 0.0;
    elFrequencyPenalty.value = freq;
    document.getElementById('val-frequencyPenalty').textContent = freq.toFixed(1);

    const pres = config.presence_penalty ?? 0.0;
    elPresencePenalty.value = pres;
    document.getElementById('val-presencePenalty').textContent = pres.toFixed(1);

    elStreamSelect.value = (config.stream ?? true).toString();

    // --- VLM 初始化 ---
    if (elVlmEnabled) {
      const vlmActive = config.vlm_enabled ?? false;
      elVlmEnabled.value = vlmActive.toString();
      elVlmConfigGroup.style.display = vlmActive ? 'block' : 'none';
      elVlmBaseUrl.value = config.vlm_baseurl || '';
      elVlmApiKey.value = config.vlm_apikey || '';
      elVlmModel.value = config.vlm_model || '';
    }

    // 自动连接一次获取最新模型
    await getModels();

  } catch (e) {
    console.error("Init Error:", e);
  }
}

function renderSelect(selectEl, list, selectedValue, emptyText) {
  selectEl.innerHTML = '';
  if (!list || list.length === 0) {
    selectEl.innerHTML = `<option value="">${emptyText}</option>`;
    return;
  }
  list.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.innerText = item;
    if (item === selectedValue) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

// ==========================================
// 2. 保存配置接口
// ==========================================
async function saveConfig(isManualSave = false) {
  const data = {
    // 基础
    baseurl: elBaseUrl.value,
    apikey: elApiKey.value,
    model: elModelSelect.value || '',
    models: currentModels,
    preset: elPresetSelect.value || '',
    presets: currentPresets,

    // 高级参数
    max_tokens: parseInt(elMaxTokens.value) || 1024,
    temperature: parseFloat(elTemperature.value),
    top_p: parseFloat(elTopP.value),
    frequency_penalty: parseFloat(elFrequencyPenalty.value),
    presence_penalty: parseFloat(elPresencePenalty.value),
    stream: elStreamSelect.value === 'true',

    // VLM 参数
    vlm_enabled: elVlmEnabled.value === 'true',
    vlm_baseurl: elVlmBaseUrl.value,
    vlm_apikey: elVlmApiKey.value,
    vlm_model: elVlmModel.value
  };

  try {
    const res = await fetch('/api/settings/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (isManualSave) {
      const btn = document.getElementById('saveBtn');
      const originalText = btn.innerText;
      btn.innerText = '已保存';
      setTimeout(() => btn.innerText = originalText, 1500);
    }
  } catch (e) {
    console.error('保存失败');
  }
}

// ==========================================
// 3. 连接获取模型列表
// ==========================================
async function getModels() {
  try {
    const res = await fetch('/api/settings/get/models');
    const data = await res.json();

    if (data.models && data.models.length > 0) {
      currentModels = data.models;
      const prevModel = elModelSelect.value;
      renderSelect(elModelSelect, currentModels, prevModel, '无模型');

      connectBtn.classList.add('success');
      connectBtn.innerText = '成功';

      await saveConfig(false);
    } else {
      currentModels = [];
      renderSelect(elModelSelect, currentModels, '', '无模型');
      connectBtn.classList.add('error');
      connectBtn.innerText = '失败';
    }
  } catch (e) {
    currentModels = [];
    renderSelect(elModelSelect, currentModels, '', '无模型');
    connectBtn.classList.add('error');
    connectBtn.innerText = '错误';
  }

  setTimeout(() => {
    connectBtn.innerText = '连接';
    connectBtn.classList.remove('success', 'error');
  }, 2000);
}

connectBtn.onclick = async () => {
  connectBtn.classList.remove('success', 'error');
  connectBtn.innerText = '连接中...';
  await saveConfig(false);
  await getModels();
};

// ==========================================
// 4. 预设管理：导入
// ==========================================
const fileInput = document.getElementById('presetFileInput');
document.getElementById('btnImport').onclick = () => fileInput.click();

fileInput.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/settings/upload/preset', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.status === 'success') {
      initSettings();
    }
  } catch (err) {
    console.error('上传失败');
  }
  e.target.value = '';
};

// ==========================================
// 5. 预设管理：导出
// ==========================================
document.getElementById('btnExport').onclick = () => {
  const preset = elPresetSelect.value;
  if (!preset) return;
  window.location.href = `/api/settings/download/preset?filename=${encodeURIComponent(preset)}`;
};

// ==========================================
// 6. 预设管理：删除
// ==========================================
document.getElementById('btnDelete').onclick = async () => {
  const preset = elPresetSelect.value;
  if (!preset) return;

  try {
    const res = await fetch('/api/settings/delete/preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: preset })
    });
    const data = await res.json();
    if (data.status === 'success') {
      initSettings();
    }
  } catch (err) {
    console.error('请求失败');
  }
};

// 保存按钮绑定
document.getElementById('saveBtn').onclick = () => saveConfig(true);

// ==========================================
// 7. 星空背景动画效果
// ==========================================
const c = document.getElementById('stars');
const ctx = c.getContext('2d');
c.width = window.innerWidth;
c.height = window.innerHeight;
let stars = [];
for (let i = 0; i < 120; i++) {
  stars.push({
    x: Math.random() * c.width,
    y: Math.random() * c.height,
    r: Math.random() * 1.5,
    a: Math.random(),
    t: Math.random() * 0.02
  });
}
function draw() {
  ctx.clearRect(0, 0, c.width, c.height);
  stars.forEach(s => {
    s.a += s.t;
    if (s.a <= 0 || s.a >= 1) s.t *= -1;
    ctx.globalAlpha = s.a;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  requestAnimationFrame(draw);
}
draw();

window.addEventListener('resize', () => {
  c.width = window.innerWidth;
  c.height = window.innerHeight;
});

// 初始化
window.addEventListener('DOMContentLoaded', initSettings);