#!/usr/bin/env node
/**
 * Generate THIRD-PARTY-NOTICES.md from package-lock.json.
 *
 * Collects every production dependency (lockfile entries that are not marked
 * "dev"/"devOptional"/"link"), including the root package itself, sorted by
 * name@version (case-insensitive). For each package the section carries the
 * license identifier, a best-effort copyright line (package.json
 * author/repository, falling back to the package name) and the full license
 * text. A package-shipped LICENSE file is the preferred text source; when a
 * package does not ship one, the canonical text for its declared license
 * identifier is reproduced from the embedded fallback table and the section
 * says so. Multi-license identifiers ("AFL-2.1 OR BSD-3-Clause") get every
 * candidate text with a choose-one note. If neither a shipped file nor a
 * canonical template exists, the section degrades to a declaration-only note
 * and the script lists it on stderr.
 *
 * Output is deterministic: sorted, LF line endings, no timestamps — so CI can
 * `git diff --exit-code` the committed file against a regeneration.
 *
 * Usage:
 *   npm run notices
 *   node scripts/gen-third-party-notices.mjs [--lock <path>] [--root <dir>] [--out <path>]
 *
 * Defaults: --root <cwd>, --lock <root>/package-lock.json,
 * --out <root>/THIRD-PARTY-NOTICES.md.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Canonical license texts, keyed by SPDX identifier. "{{COPYRIGHT}}" is
 * replaced with the per-package copyright line when the text is used. */
const CANONICAL_LICENSE_TEXTS = JSON.parse("{\n  \"MIT\": \"MIT License\\n\\nCopyright (c) {{COPYRIGHT}}\\n\\nPermission is hereby granted, free of charge, to any person obtaining a copy\\nof this software and associated documentation files (the \\\"Software\\\"), to deal\\nin the Software without restriction, including without limitation the rights\\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\\ncopies of the Software, and to permit persons to whom the Software is\\nfurnished to do so, subject to the following conditions:\\n\\nThe above copyright notice and this permission notice shall be included in all\\ncopies or substantial portions of the Software.\\n\\nTHE SOFTWARE IS PROVIDED \\\"AS IS\\\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\\nSOFTWARE.\",\n  \"Apache-2.0\": \"\\n                                 Apache License\\n                           Version 2.0, January 2004\\n                        http://www.apache.org/licenses/\\n\\n   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\\n\\n   1. Definitions.\\n\\n      \\\"License\\\" shall mean the terms and conditions for use, reproduction,\\n      and distribution as defined by Sections 1 through 9 of this document.\\n\\n      \\\"Licensor\\\" shall mean the copyright owner or entity authorized by\\n      the copyright owner that is granting the License.\\n\\n      \\\"Legal Entity\\\" shall mean the union of the acting entity and all\\n      other entities that control, are controlled by, or are under common\\n      control with that entity. For the purposes of this definition,\\n      \\\"control\\\" means (i) the power, direct or indirect, to cause the\\n      direction or management of such entity, whether by contract or\\n      otherwise, or (ii) ownership of fifty percent (50%) or more of the\\n      outstanding shares, or (iii) beneficial ownership of such entity.\\n\\n      \\\"You\\\" (or \\\"Your\\\") shall mean an individual or Legal Entity\\n      exercising permissions granted by this License.\\n\\n      \\\"Source\\\" form shall mean the preferred form for making modifications,\\n      including but not limited to software source code, documentation\\n      source, and configuration files.\\n\\n      \\\"Object\\\" form shall mean any form resulting from mechanical\\n      transformation or translation of a Source form, including but\\n      not limited to compiled object code, generated documentation,\\n      and conversions to other media types.\\n\\n      \\\"Work\\\" shall mean the work of authorship, whether in Source or\\n      Object form, made available under the License, as indicated by a\\n      copyright notice that is included in or attached to the work\\n      (an example is provided in the Appendix below).\\n\\n      \\\"Derivative Works\\\" shall mean any work, whether in Source or Object\\n      form, that is based on (or derived from) the Work and for which the\\n      editorial revisions, annotations, elaborations, or other modifications\\n      represent, as a whole, an original work of authorship. For the purposes\\n      of this License, Derivative Works shall not include works that remain\\n      separable from, or merely link (or bind by name) to the interfaces of,\\n      the Work and Derivative Works thereof.\\n\\n      \\\"Contribution\\\" shall mean any work of authorship, including\\n      the original version of the Work and any modifications or additions\\n      to that Work or Derivative Works thereof, that is intentionally\\n      submitted to Licensor for inclusion in the Work by the copyright owner\\n      or by an individual or Legal Entity authorized to submit on behalf of\\n      the copyright owner. For the purposes of this definition, \\\"submitted\\\"\\n      means any form of electronic, verbal, or written communication sent\\n      to the Licensor or its representatives, including but not limited to\\n      communication on electronic mailing lists, source code control systems,\\n      and issue tracking systems that are managed by, or on behalf of, the\\n      Licensor for the purpose of discussing and improving the Work, but\\n      excluding communication that is conspicuously marked or otherwise\\n      designated in writing by the copyright owner as \\\"Not a Contribution.\\\"\\n\\n      \\\"Contributor\\\" shall mean Licensor and any individual or Legal Entity\\n      on behalf of whom a Contribution has been received by Licensor and\\n      subsequently incorporated within the Work.\\n\\n   2. Grant of Copyright License. Subject to the terms and conditions of\\n      this License, each Contributor hereby grants to You a perpetual,\\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\\n      copyright license to reproduce, prepare Derivative Works of,\\n      publicly display, publicly perform, sublicense, and distribute the\\n      Work and such Derivative Works in Source or Object form.\\n\\n   3. Grant of Patent License. Subject to the terms and conditions of\\n      this License, each Contributor hereby grants to You a perpetual,\\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\\n      (except as stated in this section) patent license to make, have made,\\n      use, offer to sell, sell, import, and otherwise transfer the Work,\\n      where such license applies only to those patent claims licensable\\n      by such Contributor that are necessarily infringed by their\\n      Contribution(s) alone or by combination of their Contribution(s)\\n      with the Work to which such Contribution(s) was submitted. If You\\n      institute patent litigation against any entity (including a\\n      cross-claim or counterclaim in a lawsuit) alleging that the Work\\n      or a Contribution incorporated within the Work constitutes direct\\n      or contributory patent infringement, then any patent licenses\\n      granted to You under this License for that Work shall terminate\\n      as of the date such litigation is filed.\\n\\n   4. Redistribution. You may reproduce and distribute copies of the\\n      Work or Derivative Works thereof in any medium, with or without\\n      modifications, and in Source or Object form, provided that You\\n      meet the following conditions:\\n\\n      (a) You must give any other recipients of the Work or\\n          Derivative Works a copy of this License; and\\n\\n      (b) You must cause any modified files to carry prominent notices\\n          stating that You changed the files; and\\n\\n      (c) You must retain, in the Source form of any Derivative Works\\n          that You distribute, all copyright, patent, trademark, and\\n          attribution notices from the Source form of the Work,\\n          excluding those notices that do not pertain to any part of\\n          the Derivative Works; and\\n\\n      (d) If the Work includes a \\\"NOTICE\\\" text file as part of its\\n          distribution, then any Derivative Works that You distribute must\\n          include a readable copy of the attribution notices contained\\n          within such NOTICE file, excluding those notices that do not\\n          pertain to any part of the Derivative Works, in at least one\\n          of the following places: within a NOTICE text file distributed\\n          as part of the Derivative Works; within the Source form or\\n          documentation, if provided along with the Derivative Works; or,\\n          within a display generated by the Derivative Works, if and\\n          wherever such third-party notices normally appear. The contents\\n          of the NOTICE file are for informational purposes only and\\n          do not modify the License. You may add Your own attribution\\n          notices within Derivative Works that You distribute, alongside\\n          or as an addendum to the NOTICE text from the Work, provided\\n          that such additional attribution notices cannot be construed\\n          as modifying the License.\\n\\n      You may add Your own copyright statement to Your modifications and\\n      may provide additional or different license terms and conditions\\n      for use, reproduction, or distribution of Your modifications, or\\n      for any such Derivative Works as a whole, provided Your use,\\n      reproduction, and distribution of the Work otherwise complies with\\n      the conditions stated in this License.\\n\\n   5. Submission of Contributions. Unless You explicitly state otherwise,\\n      any Contribution intentionally submitted for inclusion in the Work\\n      by You to the Licensor shall be under the terms and conditions of\\n      this License, without any additional terms or conditions.\\n      Notwithstanding the above, nothing herein shall supersede or modify\\n      the terms of any separate license agreement you may have executed\\n      with Licensor regarding such Contributions.\\n\\n   6. Trademarks. This License does not grant permission to use the trade\\n      names, trademarks, service marks, or product names of the Licensor,\\n      except as required for reasonable and customary use in describing the\\n      origin of the Work and reproducing the content of the NOTICE file.\\n\\n   7. Disclaimer of Warranty. Unless required by applicable law or\\n      agreed to in writing, Licensor provides the Work (and each\\n      Contributor provides its Contributions) on an \\\"AS IS\\\" BASIS,\\n      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or\\n      implied, including, without limitation, any warranties or conditions\\n      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A\\n      PARTICULAR PURPOSE. You are solely responsible for determining the\\n      appropriateness of using or redistributing the Work and assume any\\n      risks associated with Your exercise of permissions under this License.\\n\\n   8. Limitation of Liability. In no event and under no legal theory,\\n      whether in tort (including negligence), contract, or otherwise,\\n      unless required by applicable law (such as deliberate and grossly\\n      negligent acts) or agreed to in writing, shall any Contributor be\\n      liable to You for damages, including any direct, indirect, special,\\n      incidental, or consequential damages of any character arising as a\\n      result of this License or out of the use or inability to use the\\n      Work (including but not limited to damages for loss of goodwill,\\n      work stoppage, computer failure or malfunction, or any and all\\n      other commercial damages or losses), even if such Contributor\\n      has been advised of the possibility of such damages.\\n\\n   9. Accepting Warranty or Additional Liability. While redistributing\\n      the Work or Derivative Works thereof, You may choose to offer,\\n      and charge a fee for, acceptance of support, warranty, indemnity,\\n      or other liability obligations and/or rights consistent with this\\n      License. However, in accepting such obligations, You may act only\\n      on Your own behalf and on Your sole responsibility, not on behalf\\n      of any other Contributor, and only if You agree to indemnify,\\n      defend, and hold each Contributor harmless for any liability\\n      incurred by, or claims asserted against, such Contributor by reason\\n      of your accepting any such warranty or additional liability.\\n\\n   END OF TERMS AND CONDITIONS\\n\\n   APPENDIX: How to apply the Apache License to your work.\\n\\n      To apply the Apache License to your work, attach the following\\n      boilerplate notice, with the fields enclosed by brackets \\\"[]\\\"\\n      replaced with your own identifying information. (Don't include\\n      the brackets!)  The text should be enclosed in the appropriate\\n      comment syntax for the file format. We also recommend that a\\n      file or class name and description of purpose be included on the\\n      same \\\"printed page\\\" as the copyright notice for easier\\n      identification within third-party archives.\\n\\n   Copyright [yyyy] [name of copyright owner]\\n\\n   Licensed under the Apache License, Version 2.0 (the \\\"License\\\");\\n   you may not use this file except in compliance with the License.\\n   You may obtain a copy of the License at\\n\\n       http://www.apache.org/licenses/LICENSE-2.0\\n\\n   Unless required by applicable law or agreed to in writing, software\\n   distributed under the License is distributed on an \\\"AS IS\\\" BASIS,\\n   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\\n   See the License for the specific language governing permissions and\\n   limitations under the License.\",\n  \"BSD-3-Clause\": \"Copyright (c) {{COPYRIGHT}}. All rights reserved.\\n\\nRedistribution and use in source and binary forms, with or without\\nmodification, are permitted provided that the following conditions are\\nmet:\\n\\n* Redistributions of source code must retain the above copyright\\n  notice, this list of conditions and the following disclaimer.\\n* Redistributions in binary form must reproduce the above copyright\\n  notice, this list of conditions and the following disclaimer in the\\n  documentation and/or other materials provided with the distribution.\\n* Neither the name of its author, nor the names of its contributors\\n  may be used to endorse or promote products derived from this software\\n  without specific prior written permission.\\n\\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS\\n\\\"AS IS\\\" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT\\nLIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR\\nA PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT\\nOWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,\\nSPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT\\nLIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,\\nDATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY\\nTHEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\\n(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\",\n  \"BSD-2-Clause\": \"Copyright (c) {{COPYRIGHT}}.\\n\\nRedistribution and use in source and binary forms, with or without\\nmodification, are permitted provided that the following conditions are met:\\n\\n  * Redistributions of source code must retain the above copyright\\n    notice, this list of conditions and the following disclaimer.\\n  * Redistributions in binary form must reproduce the above copyright\\n    notice, this list of conditions and the following disclaimer in the\\n    documentation and/or other materials provided with the distribution.\\n\\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \\\"AS IS\\\"\\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE\\nARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY\\nDIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES\\n(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;\\nLOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND\\nON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\\n(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF\\nTHIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\",\n  \"Unlicense\": \"This is free and unencumbered software released into the public domain.\\n\\nAnyone is free to copy, modify, publish, use, compile, sell, or\\ndistribute this software, either in source code form or as a compiled\\nbinary, for any purpose, commercial or non-commercial, and by any\\nmeans.\\n\\nIn jurisdictions that recognize copyright laws, the author or authors\\nof this software dedicate any and all copyright interest in the\\nsoftware to the public domain. We make this dedication for the benefit\\nof the public at large and to the detriment of our heirs and\\nsuccessors. We intend this dedication to be an overt act of\\nrelinquishment in perpetuity of all present and future rights to this\\nsoftware under copyright law.\\n\\nTHE SOFTWARE IS PROVIDED \\\"AS IS\\\", WITHOUT WARRANTY OF ANY KIND,\\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.\\nIN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR\\nOTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,\\nARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR\\nOTHER DEALINGS IN THE SOFTWARE.\\n\\nFor more information, please refer to <http://unlicense.org>\",\n  \"0BSD\": \"Copyright (c) {{COPYRIGHT}}.\\n\\nPermission to use, copy, modify, and/or distribute this software for any\\npurpose with or without fee is hereby granted.\\n\\nTHE SOFTWARE IS PROVIDED \\\"AS IS\\\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH\\nREGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY\\nAND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,\\nINDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM\\nLOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR\\nOTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR\\nPERFORMANCE OF THIS SOFTWARE.\",\n  \"ISC\": \"The ISC License\\n\\nCopyright (c) {{COPYRIGHT}}\\n\\nPermission to use, copy, modify, and/or distribute this software for any\\npurpose with or without fee is hereby granted, provided that the above\\ncopyright notice and this permission notice appear in all copies.\\n\\nTHE SOFTWARE IS PROVIDED \\\"AS IS\\\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR\\nIN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\",\n  \"AFL-2.1\": \"This Academic Free License (the \\\"License\\\") applies to any original work of\\nauthorship (the \\\"Original Work\\\") whose owner (the \\\"Licensor\\\") has placed the\\nfollowing notice immediately following the copyright notice for the Original\\nWork:\\n\\nLicensed under the Academic Free License version 2.1\\n\\n1) Grant of Copyright License. Licensor hereby grants You a world-wide,\\nroyalty-free, non-exclusive, perpetual, sublicenseable license to do the\\nfollowing:\\n\\na) to reproduce the Original Work in copies;\\n\\nb) to prepare derivative works (\\\"Derivative Works\\\") based upon the Original\\nWork;\\n\\nc) to distribute copies of the Original Work and Derivative Works to the\\npublic;\\n\\nd) to perform the Original Work publicly; and\\n\\ne) to display the Original Work publicly.\\n\\n2) Grant of Patent License. Licensor hereby grants You a world-wide,\\nroyalty-free, non-exclusive, perpetual, sublicenseable license, under patent\\nclaims owned or controlled by the Licensor that are embodied in the Original\\nWork as furnished by the Licensor, to make, use, sell and offer for sale the\\nOriginal Work and Derivative Works.\\n\\n3) Grant of Source Code License. The term \\\"Source Code\\\" means the preferred\\nform of the Original Work for making modifications to it and all available\\ndocumentation describing how to modify the Original Work. Licensor hereby\\nagrees to provide a machine-readable copy of the Source Code of the Original\\nWork along with each copy of the Original Work that Licensor distributes.\\nLicensor reserves the right to satisfy this obligation by placing a\\nmachine-readable copy of the Source Code in an information repository\\nreasonably calculated to permit inexpensive and convenient access by You for as\\nlong as Licensor continues to distribute the Original Work, and by publishing\\nthe address of that information repository in a notice immediately following\\nthe copyright notice that applies to the Original Work.\\n\\n4) Exclusions From License Grant. Neither the names of Licensor, nor the names\\nof any contributors to the Original Work, nor any of their trademarks or\\nservice marks, may be used to endorse or promote products derived from this\\nOriginal Work without express prior written permission of the Licensor. Nothing\\nin this License shall be deemed to grant any rights to trademarks, copyrights,\\npatents, trade secrets or any other intellectual property of Licensor except as\\nexpressly stated herein. No patent license is granted to make, use, sell or\\noffer to sell embodiments of any patent claims other than the licensed claims\\ndefined in Section 2. No right is granted to the trademarks of Licensor even if\\nsuch marks are included in the Original Work. Nothing in this License shall be\\ninterpreted to prohibit Licensor from licensing under different terms from this\\nLicense any Original Work that Licensor otherwise would have a right to\\nlicense.\\n\\n5) This section intentionally omitted.\\n\\n6) Attribution Rights. You must retain, in the Source Code of any Derivative\\nWorks that You create, all copyright, patent or trademark notices from the\\nSource Code of the Original Work, as well as any notices of licensing and any\\ndescriptive text identified therein as an \\\"Attribution Notice.\\\" You must cause\\nthe Source Code for any Derivative Works that You create to carry a prominent\\nAttribution Notice reasonably calculated to inform recipients that You have\\nmodified the Original Work.\\n\\n7) Warranty of Provenance and Disclaimer of Warranty. Licensor warrants that\\nthe copyright in and to the Original Work and the patent rights granted herein\\nby Licensor are owned by the Licensor or are sublicensed to You under the terms\\nof this License with the permission of the contributor(s) of those copyrights\\nand patent rights. Except as expressly stated in the immediately proceeding\\nsentence, the Original Work is provided under this License on an \\\"AS IS\\\" BASIS\\nand WITHOUT WARRANTY, either express or implied, including, without limitation,\\nthe warranties of NON-INFRINGEMENT, MERCHANTABILITY or FITNESS FOR A PARTICULAR\\nPURPOSE. THE ENTIRE RISK AS TO THE QUALITY OF THE ORIGINAL WORK IS WITH YOU.\\nThis DISCLAIMER OF WARRANTY constitutes an essential part of this License. No\\nlicense to Original Work is granted hereunder except under this disclaimer.\\n\\n8) Limitation of Liability. Under no circumstances and under no legal theory,\\nwhether in tort (including negligence), contract, or otherwise, shall the\\nLicensor be liable to any person for any direct, indirect, special, incidental,\\nor consequential damages of any character arising as a result of this License\\nor the use of the Original Work including, without limitation, damages for loss\\nof goodwill, work stoppage, computer failure or malfunction, or any and all\\nother commercial damages or losses. This limitation of liability shall not\\napply to liability for death or personal injury resulting from Licensor's\\nnegligence to the extent applicable law prohibits such limitation. Some\\njurisdictions do not allow the exclusion or limitation of incidental or\\nconsequential damages, so this exclusion and limitation may not apply to You.\\n\\n9) Acceptance and Termination. If You distribute copies of the Original Work or\\na Derivative Work, You must make a reasonable effort under the circumstances to\\nobtain the express assent of recipients to the terms of this License. Nothing\\nelse but this License (or another written agreement between Licensor and You)\\ngrants You permission to create Derivative Works based upon the Original Work\\nor to exercise any of the rights granted in Section 1 herein, and any attempt\\nto do so except under the terms of this License (or another written agreement\\nbetween Licensor and You) is expressly prohibited by U.S. copyright law, the\\nequivalent laws of other countries, and by international treaty. Therefore, by\\nexercising any of the rights granted to You in Section 1 herein, You indicate\\nYour acceptance of this License and all of its terms and conditions.\\n\\n10) Termination for Patent Action. This License shall terminate automatically\\nand You may no longer exercise any of the rights granted to You by this License\\nas of the date You commence an action, including a cross-claim or counterclaim,\\nagainst Licensor or any licensee alleging that the Original Work infringes a\\npatent. This termination provision shall not apply for an action alleging\\npatent infringement by combinations of the Original Work with other software or\\nhardware.\\n\\n11) Jurisdiction, Venue and Governing Law. Any action or suit relating to this\\nLicense may be brought only in the courts of a jurisdiction wherein the\\nLicensor resides or in which Licensor conducts its primary business, and under\\nthe laws of that jurisdiction excluding its conflict-of-law provisions. The\\napplication of the United Nations Convention on Contracts for the International\\nSale of Goods is expressly excluded. Any use of the Original Work outside the\\nscope of this License or after its termination shall be subject to the\\nrequirements and penalties of the U.S. Copyright Act, 17 U.S.C. Â§ 101 et\\nseq., the equivalent laws of other countries, and international treaty. This\\nsection shall survive the termination of this License.\\n\\n12) Attorneys Fees. In any action to enforce the terms of this License or\\nseeking damages relating thereto, the prevailing party shall be entitled to\\nrecover its costs and expenses, including, without limitation, reasonable\\nattorneys' fees and costs incurred in connection with such action, including\\nany appeal of such action. This section shall survive the termination of this\\nLicense.\\n\\n13) Miscellaneous. This License represents the complete agreement concerning\\nthe subject matter hereof. If any provision of this License is held to be\\nunenforceable, such provision shall be reformed only to the extent necessary to\\nmake it enforceable.\\n\\n14) Definition of \\\"You\\\" in This License. \\\"You\\\" throughout this License, whether\\nin upper or lower case, means an individual or a legal entity exercising rights\\nunder, and complying with all of the terms of, this License. For legal\\nentities, \\\"You\\\" includes any entity that controls, is controlled by, or is\\nunder common control with you. For purposes of this definition, \\\"control\\\" means\\n(i) the power, direct or indirect, to cause the direction or management of such\\nentity, whether by contract or otherwise, or (ii) ownership of fifty percent\\n(50%) or more of the outstanding shares, or (iii) beneficial ownership of such\\nentity.\\n\\n15) Right to Use. You may use the Original Work in all ways not otherwise\\nrestricted or conditioned by this License or by law, and Licensor promises not\\nto interfere with or be responsible for such uses by You.\\n\\nThis license is Copyright (C) 2003-2004 Lawrence E. Rosen. All rights reserved.\\nPermission is hereby granted to copy and distribute this license without\\nmodification. This license may not be modified without the express written\\npermission of its copyright owner.\"\n}");

/** Files that count as a shipped license text, in deterministic preference
 * order. The rank keeps the winner stable when a package carries several
 * case variants (LICENSE + LICENSE.md), which must not change the output. */
function findLicenseFile(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const matches = entries.filter((f) => /^licen[cs]e(\..+)?$/i.test(f));
  const rank = (f) => {
    const lower = f.toLowerCase();
    if (lower === 'license' || lower === 'licence') return 0;
    if (lower === 'license.md' || lower === 'licence.md') return 1;
    if (lower === 'license.txt' || lower === 'licence.txt') return 2;
    return 3;
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  matches.sort((a, b) => rank(a) - rank(b) || cmp(a.toLowerCase(), b.toLowerCase()));
  for (const f of matches) {
    const p = join(dir, f);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* unreadable entry: keep scanning */
    }
  }
  return null;
}

/** Best-effort copyright holder: package.json author, else repository,
 * else the package name. */
function copyrightHolder(meta, name) {
  const author = meta.author;
  if (author) {
    if (typeof author === 'string' && author.trim()) return author.trim();
    if (typeof author === 'object' && author.name) return author.name;
  }
  const repo = meta.repository?.url ?? (typeof meta.repository === 'string' ? meta.repository : undefined);
  if (repo) return repo;
  return name;
}

/** Package metadata merged from the shipped package.json (author/repository
 * only exist there, not in the lockfile) and the lockfile entry. */
function packageMeta(dir, lockMeta) {
  let shipped = {};
  try {
    shipped = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    /* missing package.json: rely on the lockfile entry */
  }
  return { ...lockMeta, author: shipped.author ?? lockMeta.author, repository: shipped.repository ?? lockMeta.repository, homepage: shipped.homepage ?? lockMeta.homepage };
}

/** A repository/homepage URL for attribution, else the npm package page. */
function sourceUrl(meta, name) {
  const raw = meta.repository?.url ?? (typeof meta.repository === 'string' ? meta.repository : undefined) ?? meta.homepage;
  if (raw) {
    return String(raw).replace(/^git\+/, '').replace(/^git:\/\//i, 'https://').replace(/\.git$/, '');
  }
  return `https://www.npmjs.com/package/${name}`;
}

/** SPDX identifiers in a license expression: "MIT" -> ["MIT"],
 * "(AFL-2.1 OR BSD-3-Clause)" -> ["AFL-2.1", "BSD-3-Clause"]. */
function licenseIdentifiers(license) {
  if (typeof license !== 'string') return [];
  return license
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Production dependency set from the lockfile: every entry not marked
 * dev/devOptional/link, plus the root package itself. Nested duplicates of
 * the same name@version collapse to their top-most occurrence. */
function productionPackages(lockPath) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const byKey = new Map();
  for (const [entryPath, meta] of Object.entries(lock.packages ?? {})) {
    if (meta.dev || meta.devOptional || meta.link || !meta.version) continue;
    const name = entryPath === '' ? (lock.name ?? '') : entryPath.split('node_modules/').pop();
    if (!name) continue;
    const key = `${name}@${meta.version}`.toLowerCase();
    const existing = byKey.get(key);
    if (existing && existing.path.length <= entryPath.length) continue;
    byKey.set(key, { name, version: meta.version, license: meta.license, path: entryPath });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...byKey.values()].sort((a, b) => {
    const ka = `${a.name}@${a.version}`.toLowerCase();
    const kb = `${b.name}@${b.version}`.toLowerCase();
    return cmp(ka, kb) || cmp(`${a.name}@${a.version}`, `${b.name}@${b.version}`);
  });
}

function normalizeText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

function fillTemplate(template, holder) {
  return template.replaceAll('{{COPYRIGHT}}', holder);
}

/** Markers that a genuine license text of the given identifiers must contain.
 * A file missing them is a stub ("See the LICENSE file in the root"), not a
 * license, so the canonical text is used instead. */
const LICENSE_MARKERS = {
  'Apache-2.0': ['Apache License', 'Version 2.0'],
  MIT: ['Permission is hereby granted'],
  'BSD-3-Clause': ['Redistribution and use in source and binary forms'],
  'BSD-2-Clause': ['Redistribution and use in source and binary forms'],
  ISC: ['Permission to use, copy, modify'],
  '0BSD': ['Permission to use, copy, modify'],
  Unlicense: ['free and unencumbered software'],
  'AFL-2.1': ['Academic Free License']
};

function looksLikeLicenseText(text, ids) {
  if (ids.length === 0) return true;
  // At least one declared identifier's full marker set must be present.
  return ids.some((id) => {
    const markers = LICENSE_MARKERS[id];
    return markers ? markers.every((marker) => text.includes(marker)) : true;
  });
}

function fallbackBody(pkg, holder, url, ids, note) {
  const texts = ids.map((id) => fillTemplate(CANONICAL_LICENSE_TEXTS[id], holder)).join('\n---\n\n');
  return `${texts}\n\n${note}\nAttribution: ${pkg.name}@${pkg.version}, see ${url}\n`;
}

function fallbackNote(ids) {
  return ids.length === 1
    ? `License text: not shipped in the package tarball; canonical ${ids[0]} text reproduced above.`
    : `License text: not shipped in the package tarball; canonical ${ids.join(' and ')} texts reproduced above; dual-licensed, choose either license.`;
}

function renderSection(pkg, rootDir, declarationOnly) {
  const dir = pkg.path === '' ? rootDir : join(rootDir, pkg.path);
  const meta = packageMeta(dir, pkg);
  const holder = copyrightHolder(meta, pkg.name);
  const url = sourceUrl(meta, pkg.name);
  const header = `## ${pkg.name}@${pkg.version}\n\n- License: ${pkg.license ?? 'UNKNOWN'}\n- Copyright: ${holder}\n`;
  const ids = licenseIdentifiers(pkg.license);

  const shipped = findLicenseFile(dir);
  if (shipped) {
    const text = normalizeText(readFileSync(shipped, 'utf8'));
    if (looksLikeLicenseText(text, ids)) return `${header}\n${text}\n`;
    // A stub file ("See the LICENSE file in the root") is not a license text;
    // use the canonical text, noted as such.
    const templates = ids.map((id) => CANONICAL_LICENSE_TEXTS[id]);
    if (ids.length > 0 && templates.every(Boolean)) {
      const note = `License text: the package ships only a stub pointing at its repository; canonical ${ids.join(' and ')} text reproduced above.`;
      return `${header}\n${fallbackBody(pkg, holder, url, ids, note)}`;
    }
    return `${header}\n${text}\n`;
  }

  const templates = ids.map((id) => CANONICAL_LICENSE_TEXTS[id]);
  if (ids.length === 0 || templates.some((t) => !t)) {
    // No template for this identifier: declaration-only, flagged on stderr.
    declarationOnly.push(`${pkg.name}@${pkg.version} (${pkg.license})`);
    return `${header}\nLicense text: declared "${pkg.license}" via npm metadata; not shipped in the package tarball.\nAttribution: ${pkg.name}@${pkg.version}, see ${url}\n`;
  }

  return `${header}\n${fallbackBody(pkg, holder, url, ids, fallbackNote(ids))}`;
}

export function generateNotices(lockPath, rootDir) {
  const packages = productionPackages(lockPath);
  const declarationOnly = [];
  const sections = packages.map((pkg) => renderSection(pkg, rootDir, declarationOnly));
  const header = [
    '# Third-Party Notices',
    '',
    'Full license texts for every production dependency of this repository,',
    'generated from package-lock.json.',
    '',
    `- Generator: scripts/gen-third-party-notices.mjs`,
    `- Command: npm run notices`,
    `- Packages: ${packages.length} (production dependencies plus the root package)`,
    '',
    'Do not edit this file by hand: after adding or updating a dependency, run',
    '`npm run notices` and commit the regenerated file. CI regenerates and diffs',
    'this file to catch stale notices.',
    ''
  ].join('\n');
  const body = sections.join('\n---\n\n');
  return { content: `${header}\n---\n\n${body}`, declarationOnly };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const rootDir = resolve(flag('--root') ?? process.cwd());
  const lockPath = resolve(flag('--lock') ?? join(rootDir, 'package-lock.json'));
  const outPath = resolve(flag('--out') ?? join(rootDir, 'THIRD-PARTY-NOTICES.md'));

  const { content, declarationOnly } = generateNotices(lockPath, rootDir);
  writeFileSync(outPath, content, 'utf8');
  process.stdout.write(`Wrote ${outPath}\n`);
  if (declarationOnly.length > 0) {
    process.stderr.write(`Declaration-only (no shipped file, no canonical template): ${declarationOnly.join('; ')}\n`);
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
