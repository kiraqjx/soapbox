<script setup>
import { RouterLink } from 'vue-router'
import { SCENE_FAMILIES } from '../services/scenes'

const EMAIL = '2631133172@qq.com'
const GITHUB = 'https://github.com/kiraqjx/soapbox'

const steps = [
  {
    num: '01',
    title: '先挑一个场合',
    desc: '周会三分钟、年会十分钟、客户提案、面试答辩——先告诉我这是哪一种。称呼、详略和收尾，都会跟着变。',
  },
  {
    num: '02',
    title: '把 PPT 和旧稿丢进来',
    desc: 'PPTX、DOCX、PDF 在浏览器里直接读，帮你挑出要点和数字，再按这个场合重新排一遍。',
  },
  {
    num: '03',
    title: '一句一句改到顺口',
    desc: '拿不准的句子直接问它，改前改后摆在一起看。采纳哪一句，你说了算。',
  },
]

const capabilities = [
  {
    title: '一场一档',
    desc: '六种场合，六种说法。同一份素材换个场合，就是另一篇稿子。',
  },
  {
    title: '会读 PPT 的起稿搭子',
    desc: '解析 .pptx / .docx / .pdf 的文字与结构，自动抽标题、要点、数据，正文卡在你给的时长里。',
  },
  {
    title: '改稿会看场合',
    desc: '汇报先看结论和请求，演讲先看钩子和金句，答辩先看 STAR 和反问。改哪里、为什么改，都写在旁边。',
  },
  {
    title: '聊十轮也不会忘',
    desc: '「再短一点」「开场换成故事」「加一句金句」——每一轮它都记得你的场合、素材和当前稿子。',
  },
]
</script>

<template>
  <main class="page">
    <section class="hero">
      <div>
        <div class="eyebrow">二〇二六 · 当众表达工坊</div>
        <h1>
          想说的话，<br />
          我们陪你<em>说清楚</em>。
        </h1>
        <p class="hero__lead">
          三分钟的周会、二十分钟的演讲、一场客户提案，或者一次答辩——真正让人卡住的，
          常常是「对谁、用多久、按什么顺序说」。我们会先弄明白你的场合，
          再读你的 PPT 和旧稿，然后陪你一句一句改到能顺口讲出来。
        </p>
        <div class="hero__actions">
          <RouterLink to="/profiles" class="btn btn--sun">先说说你的场合</RouterLink>
          <RouterLink to="/revise" class="btn btn--ghost">拿旧稿来试改</RouterLink>
        </div>
        <div class="hero__meta">
          <div>
            <b>6</b>
            <span>种场合</span>
          </div>
          <div>
            <b>3</b>
            <span>步成稿</span>
          </div>
          <div>
            <b>逐字</b>
            <span>差异对照</span>
          </div>
          <div>
            <b>本地</b>
            <span>文件解析</span>
          </div>
        </div>
      </div>

      <aside class="poster" aria-label="改稿示例">
        <div class="poster__tag">
          <span>改稿样本 · NO. 07</span>
          <span>主题演讲</span>
        </div>
        <p class="poster__note">
          <del>大家好，很高兴来到现场，我准备得也不是很充分，就简单跟大家分享一下我们最近做的一些工作。</del><br />
          <ins>上个月我们丢了一个客户。审计通过、价格最低，输在一句话上：他没听懂我们到底解决什么问题。</ins><br />
          <del>我们这个项目差不多做了两个月了，中间也遇到了很多问题，然后团队也挺辛苦的。</del><br />
          <ins>今天十五分钟，我只讲一件事：留存不是运营问题，是产品问题。</ins>
        </p>
        <div class="poster__foot">
          <span>钩子先行 · 一个观点</span>
          <span class="stamp" style="width: 58px; height: 58px; font-size: 9.5px">肥皂箱<br />校订</span>
        </div>
      </aside>
    </section>

    <div class="marquee" aria-hidden="true">
      <div class="marquee__inner">
        <span>结论先行</span><span>钩子开场</span><span>具体的人</span><span>能带走的清单</span>
        <span>说完就停</span><span>数字你填</span><span>只改说法</span><span>不改事实</span>
        <span>结论先行</span><span>钩子开场</span><span>具体的人</span><span>能带走的清单</span>
        <span>说完就停</span><span>数字你填</span><span>只改说法</span><span>不改事实</span>
      </div>
    </div>

    <div class="section-head">
      <h2>六种场合，六种说法</h2>
      <p>同一份材料，换个场合就是另一篇稿。点一张卡片，看看它怎么变。</p>
    </div>

    <div class="grid-3">
      <RouterLink v-for="item in SCENE_FAMILIES" :key="item.id" :to="`/profiles`" class="family-card">
        <span class="family-card__mark">{{ item.mark }}</span>
        <span class="family-card__name">{{ item.name }}</span>
        <span class="family-card__desc">{{ item.desc }}</span>
      </RouterLink>
    </div>

    <div class="section-head">
      <h2>三步，从材料到能开口</h2>
      <p>不用想太多，把材料丢进来，我们一段一段来。</p>
    </div>

    <div class="grid-3">
      <article v-for="step in steps" :key="step.num" class="step-card">
        <div class="step-card__num">{{ step.num }}</div>
        <h3>{{ step.title }}</h3>
        <p>{{ step.desc }}</p>
      </article>
    </div>

    <div class="section-head">
      <h2>四件顺手的小事</h2>
      <p>写不出来的时候，缺的常常不是漂亮句子，而是一个清楚的顺序。</p>
    </div>

    <div class="grid-2">
      <article v-for="cap in capabilities" :key="cap.title" class="card">
        <h3 style="font-size: 17px; margin-bottom: 8px">{{ cap.title }}</h3>
        <p class="muted" style="margin: 0; font-size: 13.5px; line-height: 1.9">{{ cap.desc }}</p>
      </article>
    </div>

    <div class="quote-band">
      <p>
        「汇报是帮人做决定，演讲是让人记住一句话，<br />
        分享是让人带走一个方法，致辞是让这一刻被记住。」
      </p>
      <small>肥皂箱 · 不同场合的表达目标</small>
    </div>

    <div class="section-head">
      <h2>你的材料，留在你的浏览器</h2>
      <div class="row row--wrap">
        <RouterLink to="/workspace" class="btn btn--teal">开始成稿</RouterLink>
        <RouterLink to="/settings" class="btn btn--ghost">看看数据怎么存</RouterLink>
      </div>
    </div>
    <div class="grid-3">
      <div class="card card--tight">
        <div class="card__title">只在你电脑里读</div>
        <p class="small muted" style="margin: 8px 0 0">
          PPT / Word / PDF 都在浏览器内解包读取，原始文件不会上传。
        </p>
      </div>
      <div class="card card--tight">
        <div class="card__title">想接模型也随时可以</div>
        <p class="small muted" style="margin: 8px 0 0">
          不填 Key 也能用，本地规则引擎先顶着；填了就走你自己的接口。
        </p>
      </div>
      <div class="card card--tight">
        <div class="card__title">我们守着的分寸</div>
        <p class="small muted" style="margin: 8px 0 0">
          数字、人名、业绩，都留给你自己填。缺的地方会老实标上「待补充」。
        </p>
      </div>
    </div>

    <section class="contact-band">
      <div class="contact-band__copy">
        <div class="eyebrow">缺什么，直接说</div>
        <h2>想要的功能，写信告诉我</h2>
        <p>
          这个工坊还在长：少一种场合、某个文件读不出来、改出来的句子不像你说话——
          都可以直接说一声。邮件我都会看，GitHub 上的 Issue 也一样。
        </p>
      </div>
      <div class="contact-band__actions">
        <a class="btn btn--ink" :href="`mailto:${EMAIL}`">发邮件 · {{ EMAIL }}</a>
        <a class="btn btn--ghost" :href="`${GITHUB}/issues`" target="_blank" rel="noopener">
          GitHub 提 Issue
        </a>
        <a class="contact-band__repo" :href="GITHUB" target="_blank" rel="noopener">仓库地址 →</a>
      </div>
    </section>
  </main>
</template>
