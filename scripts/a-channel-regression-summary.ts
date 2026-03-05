import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type RunStatus = 'pass' | 'fail' | 'warn';
type ScenarioStatus = 'pass' | 'fail' | 'skip';

type Metric = {
  name: string;
  unit: string;
  value: number;
};

type Scenario = {
  id: string;
  name: string;
  status: ScenarioStatus;
  metrics?: Metric[];
};

type RegressionRun = {
  summary?: {
    status?: RunStatus;
  };
  performance?: {
    sampleCount?: number;
    p50Ms?: number;
    p95Ms?: number;
  };
  scenarios?: Scenario[];
};

type CliOptions = {
  dir: string;
  pattern: string;
  output: string;
  p50Threshold: number;
  p95Threshold: number;
};

type ScenarioStats = {
  id: string;
  name: string;
  pass: number;
  fail: number;
  skip: number;
};

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const ratio = pos - lo;
  return sorted[lo] * (1 - ratio) + sorted[hi] * ratio;
}

function parseArgs(argv: string[]): CliOptions {
  let dir = path.join('logs', 'regression', 'a-channel');
  let pattern = '^run-\\d+\\.json$';
  let output = path.join('logs', 'regression', 'a-channel', 'summary.json');
  let p50Threshold = 900;
  let p95Threshold = 1500;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir' && argv[i + 1]) {
      dir = argv[++i];
    } else if (arg === '--pattern' && argv[i + 1]) {
      pattern = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      output = argv[++i];
    } else if (arg === '--p50-threshold' && argv[i + 1]) {
      const v = Number(argv[++i]);
      if (Number.isFinite(v)) p50Threshold = v;
    } else if (arg === '--p95-threshold' && argv[i + 1]) {
      const v = Number(argv[++i]);
      if (Number.isFinite(v)) p95Threshold = v;
    }
  }

  return { dir, pattern, output, p50Threshold, p95Threshold };
}

function sortFiles(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function readRun(filePath: string): Promise<RegressionRun> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as RegressionRun;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dir = path.resolve(options.dir);
  const filePattern = new RegExp(options.pattern);
  const names = (await readdir(dir)).filter((n) => filePattern.test(n)).sort(sortFiles);

  if (names.length === 0) {
    console.error(`未匹配到文件: dir=${dir}, pattern=${options.pattern}`);
    process.exit(2);
  }

  const runStatusCounts: Record<RunStatus | 'unknown', number> = {
    pass: 0,
    fail: 0,
    warn: 0,
    unknown: 0
  };
  const scenarioMap = new Map<string, ScenarioStats>();
  const metricSamples: number[] = [];
  const failedRuns: Array<{ file: string; failedScenarios: string[] }> = [];
  const invalidFiles: Array<{ file: string; error: string }> = [];

  for (const name of names) {
    const fullPath = path.join(dir, name);
    let run: RegressionRun;
    try {
      run = await readRun(fullPath);
    } catch (err) {
      invalidFiles.push({
        file: name,
        error: err instanceof Error ? err.message : String(err)
      });
      continue;
    }

    const runStatus = run.summary?.status;
    if (runStatus === 'pass' || runStatus === 'fail' || runStatus === 'warn') {
      runStatusCounts[runStatus] += 1;
    } else {
      runStatusCounts.unknown += 1;
    }

    const failedScenarioIds: string[] = [];
    for (const s of run.scenarios ?? []) {
      const existing = scenarioMap.get(s.id) ?? {
        id: s.id,
        name: s.name,
        pass: 0,
        fail: 0,
        skip: 0
      };
      if (s.status === 'pass') existing.pass += 1;
      else if (s.status === 'fail') {
        existing.fail += 1;
        failedScenarioIds.push(s.id);
      } else existing.skip += 1;
      scenarioMap.set(s.id, existing);

      for (const m of s.metrics ?? []) {
        if (m.name === 'speech_end_to_first_audio_ms' && Number.isFinite(m.value)) {
          metricSamples.push(m.value);
        }
      }
    }

    if (failedScenarioIds.length > 0) {
      failedRuns.push({ file: name, failedScenarios: failedScenarioIds });
    }
  }

  const scenarioStats = [...scenarioMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const scenarioReport = scenarioStats.map((s) => {
    const total = s.pass + s.fail + s.skip;
    return {
      ...s,
      total,
      passRate: total > 0 ? Number((s.pass / total).toFixed(4)) : 0
    };
  });

  const p50 = percentile(metricSamples, 50);
  const p95 = percentile(metricSamples, 95);
  const thresholdStatus =
    typeof p50 === 'number' && typeof p95 === 'number'
      ? p50 <= options.p50Threshold && p95 <= options.p95Threshold
        ? 'pass'
        : 'fail'
      : 'na';

  const output = {
    generatedAt: new Date().toISOString(),
    input: {
      dir,
      pattern: options.pattern,
      matchedFiles: names
    },
    runs: {
      totalMatched: names.length,
      parsed: names.length - invalidFiles.length,
      invalid: invalidFiles.length,
      runStatusCounts
    },
    scenarios: scenarioReport,
    performance: {
      metric: 'speech_end_to_first_audio_ms',
      sampleCount: metricSamples.length,
      p50Ms: p50,
      p95Ms: p95,
      thresholds: {
        p50Ms: options.p50Threshold,
        p95Ms: options.p95Threshold
      },
      thresholdStatus
    },
    failedRuns,
    invalidFiles
  };

  const outPath = path.resolve(options.output);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');

  const parsed = output.runs.parsed;
  const failedRunsCount = failedRuns.length;
  console.log('=== A 通道多轮汇总 ===');
  console.log(`输入: ${dir}`);
  console.log(`匹配文件: ${names.length} (解析成功 ${parsed}, 解析失败 ${output.runs.invalid})`);
  console.log(
    `运行状态: pass=${runStatusCounts.pass}, fail=${runStatusCounts.fail}, warn=${runStatusCounts.warn}, unknown=${runStatusCounts.unknown}`
  );
  console.log(`失败轮次: ${failedRunsCount}`);
  console.log(
    `性能样本: ${metricSamples.length}, p50=${typeof p50 === 'number' ? Math.round(p50) : 'na'}ms, p95=${
      typeof p95 === 'number' ? Math.round(p95) : 'na'
    }ms, threshold=${thresholdStatus}`
  );
  console.log(`输出文件: ${outPath}`);
}

main().catch((err) => {
  console.error('汇总失败:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

