#!/usr/bin/env node
// @ts-check
/**
 * scripts/update-prices.js
 *
 * AWS Price List Bulk API(인증 불필요)에서 서울 리전(ap-northeast-2)의
 *   - EC2 7세대 이상 인스턴스 전체 (Linux / Shared / OS 추가비용 없음)
 *   - RDS 7세대 이상 인스턴스 전체 (Single-AZ 기준, 엔진별)
 *   - EBS gp3 스토리지 단가
 * 를 추출해 public/prices.json 으로 저장한다.
 *
 * 실행: node scripts/update-prices.js
 * 요구: Node 18+ (전역 fetch 내장)
 *
 * 주의: EC2 offer 파일은 수백 MB다. 메모리 부족 시 아래로 실행:
 *   node --max-old-space-size=8192 scripts/update-prices.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REGION = "ap-northeast-2";
const BASE = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws";
const MIN_GENERATION = 7;
const OUTPUT = path.resolve(__dirname, "../public/prices.json");

const RDS_ENGINES = new Set(["MySQL", "PostgreSQL"]);

function parseGeneration(instanceType) {
  const t = instanceType.replace(/^db\./, "");
  const family = t.split(".")[0];
  const m = family.match(/^[a-z]+?(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

async function fetchOffer(serviceCode) {
  const url = `${BASE}/${serviceCode}/current/${REGION}/index.json`;
  process.stdout.write(`  내려받는 중: ${serviceCode} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${serviceCode}`);
  const json = await res.json();
  const n = Object.keys(json.products || {}).length;
  console.log(`완료 (products ${n.toLocaleString()}개)`);
  return json;
}

function onDemandUSD(data, sku) {
  const terms = data.terms?.OnDemand?.[sku];
  if (!terms) return null;
  const term = Object.values(terms)[0];
  if (!term) return null;
  const dim = Object.values(term.priceDimensions)[0];
  if (!dim) return null;
  const usd = parseFloat(dim.pricePerUnit.USD);
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

function extractEC2(data) {
  const out = {};
  for (const sku in data.products) {
    const p = data.products[sku];
    const a = p.attributes || {};
    if (p.productFamily !== "Compute Instance") continue;
    if (a.operatingSystem !== "Linux") continue;
    if (a.tenancy !== "Shared") continue;
    if (a.preInstalledSw !== "NA") continue;
    if (a.capacitystatus !== "Used") continue;
    if (!a.instanceType) continue;
    if (parseGeneration(a.instanceType) < MIN_GENERATION) continue;

    const usd = onDemandUSD(data, sku);
    if (usd == null) continue;
    out[a.instanceType] = {
      hourly: usd,
      vcpu: a.vcpu ? parseInt(a.vcpu, 10) : null,
      memory: a.memory || null,
    };
  }
  return sortByKey(out);
}

function extractRDS(data) {
  const out = {};
  for (const sku in data.products) {
    const p = data.products[sku];
    const a = p.attributes || {};
    if (p.productFamily !== "Database Instance") continue;
    if (a.deploymentOption !== "Single-AZ") continue;
    if (!a.instanceType) continue;
    if (!RDS_ENGINES.has(a.databaseEngine)) continue;
    if (parseGeneration(a.instanceType) < MIN_GENERATION) continue;

    const engine = a.databaseEngine;
    const usd = onDemandUSD(data, sku);
    if (usd == null) continue;

    const key = `${engine}|${a.instanceType}`;
    if (out[key] == null || usd < out[key].hourly) {
      out[key] = {
        engine,
        instanceType: a.instanceType,
        hourly: usd,
        vcpu: a.vcpu ? parseInt(a.vcpu, 10) : null,
        memory: a.memory || null,
      };
    }
  }
  return sortByKey(out);
}

function extractEBSgp3(data) {
  for (const sku in data.products) {
    const p = data.products[sku];
    const a = p.attributes || {};
    if (p.productFamily !== "Storage") continue;
    if (a.volumeApiName !== "gp3") continue;
    const usd = onDemandUSD(data, sku);
    if (usd == null) continue;
    return { perGbMonth: usd, usagetype: a.usagetype || null };
  }
  return null;
}

function sortByKey(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

(async () => {
  console.log(`서울(${REGION}) 단가 추출 시작\n`);

  const ec2 = await fetchOffer("AmazonEC2");
  const rds = await fetchOffer("AmazonRDS");

  console.log("\n추출 중...");
  const ec2Prices = extractEC2(ec2);
  const rdsPrices = extractRDS(rds);
  const gp3 = extractEBSgp3(ec2);

  const result = {
    _meta: {
      region: REGION,
      updated: new Date().toISOString(),
      source: "AWS Price List Bulk API (current)",
      filter: `세대 ${MIN_GENERATION} 이상 / EC2 Linux·Shared / RDS Single-AZ`,
      note: "정보 제공용 추정치. 무료티어·예약·SP·세금 미반영.",
    },
    ec2: ec2Prices,
    rds: rdsPrices,
    ebs: { gp3 },
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));

  console.log("\n── 요약 ──────────────────────────");
  console.log(`EC2  7세대+ : ${Object.keys(ec2Prices).length}개`);
  console.log(`RDS  7세대+ : ${Object.keys(rdsPrices).length}개 (엔진×타입)`);
  console.log(`EBS  gp3    : ${gp3 ? "$" + gp3.perGbMonth + "/GB-월" : "찾지 못함"}`);
  console.log(`\n저장 위치: ${OUTPUT}`);

  const sampleEc2 = Object.entries(ec2Prices).slice(0, 5);
  if (sampleEc2.length) {
    console.log("\nEC2 예시:");
    for (const [type, v] of sampleEc2) {
      console.log(`  ${type.padEnd(16)} $${v.hourly}/hr  (${v.vcpu} vCPU, ${v.memory})`);
    }
  }

  if (Object.keys(ec2Prices).length === 0) {
    console.log("\n[진단] EC2 결과 0 → Compute Instance 샘플 product 속성:");
    const sample = Object.values(ec2.products).find(p => p.productFamily === "Compute Instance");
    if (sample) {
      console.log(JSON.stringify(sample, null, 2));
    } else {
      const families = [...new Set(Object.values(ec2.products).map(p => p.productFamily))].slice(0, 20);
      console.log("  productFamily 목록:", families.join(", "));
    }
  }

  if (Object.keys(rdsPrices).length === 0) {
    console.log("\n[진단] RDS 결과 0 → Database Instance 샘플 product 속성:");
    const sample = Object.values(rds.products).find(p => p.productFamily === "Database Instance");
    if (sample) {
      console.log(JSON.stringify(sample, null, 2));
    } else {
      const families = [...new Set(Object.values(rds.products).map(p => p.productFamily))].slice(0, 20);
      console.log("  productFamily 목록:", families.join(", "));
    }
  }
})().catch((e) => {
  console.error("\n오류:", e.message);
  process.exit(1);
});
