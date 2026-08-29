const { getDb } = require('../../database/connection');
const { apiKeys, modelsConfig, settings } = require('../../database');
const { getTaiwanISOString } = require('../../utils/date');
const eventManager = require('../sse/eventManager');
const packageInfo = require('../../package.json');

const { resolveModelsCheckUrl, isCustomUpstreamUrl } = require('../utils/urlHelper');

class HealthService {
  constructor() {
    this.lastUpstreamCheck = {
      timestamp: 0,
      reachable: true,
      latencyMs: 0
    };
  }

  async checkDatabase() {
    try {
      const db = getDb();
      if (!db) return { status: 'unhealthy', error: 'Database instance not found' };
      const res = db.prepare("SELECT 1 AS ok").get();
      return { status: res && res.ok === 1 ? 'healthy' : 'unhealthy' };
    } catch (err) {
      return { status: 'unhealthy', error: err.message };
    }
  }

  async checkNvidiaApiReachable(timeoutMs = 5000) {
    const now = Date.now();
    // 60 秒記憶體快取以防短時間高頻重複打擊上游端點
    if (now - this.lastUpstreamCheck.timestamp < 60000) {
      return {
        reachable: this.lastUpstreamCheck.reachable,
        latencyMs: this.lastUpstreamCheck.latencyMs,
        cached: true
      };
    }

    const currentSettings = settings.get();
    const targetUrl = resolveModelsCheckUrl(currentSettings.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1');
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      
      const res = await fetch(targetUrl, {
        method: 'GET',
        signal: controller.signal
      }).catch(err => ({ ok: false, status: err.name === 'AbortError' ? 408 : 500 }));
      
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      const reachable = res && (res.status === 200 || res.status === 401 || res.status === 403);

      this.lastUpstreamCheck = {
        timestamp: now,
        reachable,
        latencyMs
      };

      return { reachable, latencyMs, cached: false };
    } catch (err) {
      this.lastUpstreamCheck = {
        timestamp: now,
        reachable: false,
        latencyMs: Date.now() - startTime
      };
      return { reachable: false, latencyMs: Date.now() - startTime, error: err.message };
    }
  }

  getSystemMetrics() {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptimeSec = process.uptime();

    const heapUsedMb = (memory.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMb = (memory.heapTotal / 1024 / 1024).toFixed(2);
    const rssMb = (memory.rss / 1024 / 1024).toFixed(2);

    return {
      uptime: uptimeSec,
      memory: {
        heapUsedMb: Number(heapUsedMb),
        heapTotalMb: Number(heapTotalMb),
        rssMb: Number(rssMb),
        heapUsedRatio: Number((memory.heapUsed / memory.heapTotal).toFixed(4))
      },
      cpu: {
        userMicros: cpu.user,
        systemMicros: cpu.system
      },
      sse: eventManager.getStats()
    };
  }

  async getHealthStatus(includeDeepChecks = false) {
    const currentSettings = settings.get();
    const isCustom = isCustomUpstreamUrl(currentSettings.NVIDIA_API_URL);
    const activeKeys = apiKeys.getActiveKeys();
    const allKeys = apiKeys.getAll();
    const activeModels = modelsConfig.getAll().filter(m => m.is_active === 1);
    const metrics = this.getSystemMetrics();

    let dbHealth = { status: 'healthy' };
    let upstreamHealth = { reachable: true, latencyMs: 0 };

    if (includeDeepChecks) {
      dbHealth = await this.checkDatabase();
      upstreamHealth = await this.checkNvidiaApiReachable();
    }

    let overallStatus = 'healthy';
    if (dbHealth.status !== 'healthy') {
      overallStatus = 'unhealthy';
    } else if ((!isCustom && activeKeys.length === 0) || activeModels.length === 0 || !upstreamHealth.reachable || metrics.memory.heapUsedRatio > 0.9) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      uptime: metrics.uptime,
      timestamp: getTaiwanISOString(),
      version: packageInfo.version,
      keys: { total: allKeys.length, active: activeKeys.length },
      models: { active: activeModels.length },
      dependencies: {
        database: dbHealth.status,
        nvidiaApi: upstreamHealth.reachable ? 'reachable' : 'unreachable'
      },
      metrics
    };
  }
}

module.exports = new HealthService();
