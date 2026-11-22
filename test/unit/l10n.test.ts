import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 语言包键集守卫（doc/Test/开发测试体系.md §6.16；本地化 L1/L2 契约）：
// 四份语言资源键集两两对称——bundle en/zh、package.nls en/zh。漂移（一侧加键、
// 另一侧漏加）在本守卫即时失败。直读仓库根的真实语言包（__dirname 上三级），
// 零依赖无桩。
// 注意：VDC 产品化（1.5.15）起清单不再净化；选择器去设置化（1.5.16）后 testMode
// 六键退场，package.nls 无"净化态"、恒为全量对称；清单 %key% 引用的存在性归
// verify-release-manifest.js 断言。

const repoRoot = path.join(__dirname, '..', '..', '..');

const readKeys = (rel: string): string[] => {
  const raw = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  return Object.keys(JSON.parse(raw)).sort();
};

describe('语言包键集对称（l10n 守卫）', () => {
  it('#1 bundle en/zh key sets are identical', () => {
    const en = readKeys('l10n/bundle.l10n.json');
    const zh = readKeys('l10n/bundle.l10n.zh-cn.json');
    assert.deepEqual(en, zh);
    assert.ok(en.length >= 90, `bundle keys look too small: ${en.length}`);
  });

  it('#2 package.nls en/zh key sets are identical', () => {
    const en = readKeys('package.nls.json');
    const zh = readKeys('package.nls.zh-cn.json');
    assert.deepEqual(en, zh);
    // 37 = 当前常规态键数（含 console 视图标题与 virtualConsole 描述键，无 testMode）。
    assert.ok(en.length >= 37, `package.nls keys look too small: ${en.length}`);
  });
});
