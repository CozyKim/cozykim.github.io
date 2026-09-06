/* =====================================================================
   resume-render.js — 이력서 렌더링의 "콘텐츠 규칙"을 한곳에 모은 공유 모듈.

   resume.html(독립 이력서 페이지)과 index.html(합본 PDF용 이력서 시트)이
   둘 다 이 모듈을 사용한다. HTML 조립과 CSS 는 페이지별로 다르므로 각자 두고,
   드리프트가 가장 위험한 규칙(불릿 선택·학력 파싱·기술스택 집계·인라인 마크다운)만
   공유해 두 이력서가 같은 데이터에서 동일한 내용을 내도록 보장한다.

   window.ResumeRender 로 노출. 빌드 도구 없이 <script src> 로 로드.
   ===================================================================== */
(function (global) {
  "use strict";

  function esc(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // **굵게** / `코드` 인라인 변환 (escape 후 적용)
  function inlineMd(s) {
    var t = esc(s || "");
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/`(.+?)`/g, '<span class="mono">$1</span>');
    return t;
  }

  // "### heading" 섹션 아래의 "- "/"* " 불릿들을 추출
  function sectionBullets(body, heading) {
    var lines = (body || "").split("\n"), out = [], on = false;
    for (var k = 0; k < lines.length; k++) {
      var ln = lines[k];
      if (/^#{1,6}\s/.test(ln)) { on = ln.replace(/^#{1,6}\s*/, "").trim() === heading; continue; }
      if (on) { var mm = ln.match(/^\s*[-*]\s+(.*)$/); if (mm) out.push(mm[1].trim()); }
    }
    return out;
  }

  // 불릿에서 **굵은 레이블**만 추출(없으면 null)
  function boldLabel(s) {
    var m = (s || "").match(/\*\*(.+?)\*\*/);
    return m ? m[1].replace(/`/g, "").trim() : null;
  }

  // 프로젝트의 이력서용 불릿(프로젝트당 3개): highlights(큐레이션) 우선,
  // 없으면 본문 "한 일"의 레이블 1개 + "성과"(수치 우선) 2개로 자동 구성.
  // A4 1장 제약 — 불릿이 각각 한 줄(약 46자 이하)이라는 전제에서 설명 1줄 + 불릿 3개가 프로젝트 4개 기준 상한.
  var RESUME_BULLETS = 3;
  function projectBullets(p) {
    if (p.meta.highlights) {
      return p.meta.highlights.split("||").map(function (s) { return s.trim(); })
        .filter(Boolean).slice(0, RESUME_BULLETS);
    }
    var did = sectionBullets(p.body, "한 일").map(boldLabel).filter(Boolean).slice(0, 1);
    var res = sectionBullets(p.body, "성과").slice();
    res.sort(function (a, b) { return (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0); });
    return did.concat(res).slice(0, RESUME_BULLETS);
  }

  // 프로젝트 기간(frontmatter `period`). 없으면 "".
  function projectPeriod(p) {
    return (p && p.meta && p.meta.period) ? p.meta.period.trim() : "";
  }

  // 프로젝트 설명 한 줄 — 무엇을 하는 시스템인지. 포트폴리오 카드와 같은 frontmatter `summary` 를 쓴다.
  // 성과 수치는 이 줄이 아니라 highlights 불릿에 싣는다.
  function projectDesc(p) {
    if (!p || !p.meta) return "";
    return (p.meta.summary || "").trim();
  }

  // 이력서용 핵심 기술 1~3개(frontmatter `resumeTech`). 없으면 stack 앞 3개로 폴백.
  function projectTech(p) {
    if (!p || !p.meta) return [];
    var src = p.meta.resumeTech || p.meta.stack || "";
    return src.split(",").map(function (s) { return s.trim(); })
      .filter(Boolean).slice(0, 3);
  }

  // 경력기술서 배열 규칙: 기간 시작일 기준 최신순 역순.
  // "2026.03 ~ 진행 중" → 202603 으로 비교. period 가 없으면 뒤로 보낸다.
  function periodStartKey(p) {
    var m = projectPeriod(p).match(/(\d{4})[.\-/](\d{1,2})/);
    return m ? (parseInt(m[1], 10) * 100 + parseInt(m[2], 10)) : -1;
  }
  function byRecency(projects) {
    return (projects || []).slice().sort(function (a, b) {
      return periodStartKey(b) - periodStartKey(a);
    });
  }

  // 학력 파싱: "무엇 | 기간 || 무엇2 | 기간2" → [{what, period}]
  function educationItems(meta) {
    if (!meta || !meta.education) return [];
    return meta.education.split("||").map(function (e) {
      var parts = e.split("|");
      return { what: (parts[0] || "").trim(), period: (parts[1] || "").trim() };
    }).filter(function (e) { return e.what; });
  }

  // 이력서 노출 여부: frontmatter `resume: false` 인 프로젝트는 이력서에서 제외
  // (포트폴리오 사이트에는 그대로 노출 — 이력서는 대표 프로젝트만 깊게 싣는다)
  function inResume(p) {
    return !(p && p.meta && p.meta.resume === "false");
  }

  // 이력서 전용 큐레이션 스택: "그룹명 | 항목들 || 그룹명2 | 항목들2" → [{name, items}]
  // 필드가 없으면 [] 반환 — 호출부는 aggregateStack 자동 집계로 폴백.
  function resumeStackGroups(meta) {
    if (!meta || !meta.resumeStack) return [];
    return meta.resumeStack.split("||").map(function (g) {
      var i = g.indexOf("|");
      if (i === -1) return { name: "", items: g.trim() };
      return { name: g.slice(0, i).trim(), items: g.slice(i + 1).trim() };
    }).filter(function (g) { return g.items; });
  }

  // 기술스택 집계: 프로젝트 stack + meta.stackExtra, 중복 제거.
  // dedup 키는 소문자 + 괄호 주석 "(...)" 제거. 표시값도 괄호 주석을 떼고 보관.
  function aggregateStack(projects, meta) {
    var seen = {}, stack = [];
    (projects || []).forEach(function (p) {
      ((p.meta && p.meta.stack) || "").split(",").forEach(function (s) {
        s = s.trim(); if (!s) return;
        var key = s.toLowerCase().replace(/\s*\(.*\)$/, "");
        if (!seen[key]) { seen[key] = 1; stack.push(s.replace(/\s*\(.*\)$/, "")); }
      });
    });
    (((meta && meta.stackExtra) || "")).split(",").forEach(function (s) {
      s = s.trim(); if (!s) return;
      var key = s.toLowerCase();
      if (!seen[key]) { seen[key] = 1; stack.push(s); }
    });
    return stack;
  }

  global.ResumeRender = {
    esc: esc,
    inlineMd: inlineMd,
    sectionBullets: sectionBullets,
    boldLabel: boldLabel,
    projectBullets: projectBullets,
    projectPeriod: projectPeriod,
    projectDesc: projectDesc,
    projectTech: projectTech,
    byRecency: byRecency,
    educationItems: educationItems,
    inResume: inResume,
    resumeStackGroups: resumeStackGroups,
    aggregateStack: aggregateStack
  };
})(window);
