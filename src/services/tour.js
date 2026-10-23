/**
 * 首次进入时的使用引导。
 * - target：目标元素的选择器，对应页面上的 data-tour 属性；为空时显示居中的说明卡片。
 * - route：需要切换到哪个页面；为空表示停在当前页面。
 * - placement：提示卡片优先摆放的方向，空间不够时自动换边。
 */
export const TOUR_STEPS = [
  {
    key: 'welcome',
    title: '第一次来？两分钟带你看一圈',
    body: '这里是「肥皂箱 · 当众表达工坊」：先挑场合，再把 PPT 和旧稿丢进来，最后一句一句改到顺口。我们按这个顺序走一遍。',
    target: null,
    route: null,
  },
  {
    key: 'nav',
    title: '五个入口，一条动线',
    body: '场景档案定场合和对象；成稿工坊把素材写成讲稿；改稿对照逐句诊断旧稿；模型与数据管接口和备份。顺着从左往右点就行。',
    target: '[data-tour="site-nav"]',
    placement: 'bottom',
  },
  {
    key: 'profiles-family',
    title: '第一步：先挑一个场合',
    body: '向上汇报要先给结论，主题演讲要先给钩子，经验分享要给一份能带走的清单。场合定了，整篇稿子的开场和收尾都会跟着换。',
    route: '/profiles',
    target: '[data-tour="profiles-family"]',
    placement: 'left',
  },
  {
    key: 'profiles-detail',
    title: '把对象、时长、诉求说清楚',
    body: '同一件事，对高管讲三分钟和对客户讲八分钟，是两篇稿子。这几项填一次，之后每次成稿都会自动带上。填完记得点「保存档案」。',
    route: '/profiles',
    target: '[data-tour="profiles-detail"]',
    placement: 'left',
  },
  {
    key: 'workspace-materials',
    title: '第二步：把材料丢进来',
    body: 'PPTX / DOCX / PDF 在浏览器里直接解析，自动挑出标题、要点和数字，原文件不会上传。没有素材也能先搭一版骨架。',
    route: '/workspace',
    target: '[data-tour="workspace-materials"]',
    placement: 'right',
  },
  {
    key: 'workspace-generate',
    title: '可以补一句这次想强调什么',
    body: '比如「重点讲支付链路的延期风险」「开场用一个客户故事」。不填也能写；不接 API Key 也没关系，本地规则引擎会先顶着。',
    route: '/workspace',
    target: '[data-tour="workspace-generate"]',
    placement: 'right',
  },
  {
    key: 'workspace-draft',
    title: '第三步：稿子可以当场改',
    body: '念一遍，卡住的地方就是该修的地方。改到差不多，再点「送去逐句改稿」，让改稿对照接着做诊断。',
    route: '/workspace',
    target: '[data-tour="workspace-draft"]',
    placement: 'right',
  },
  {
    key: 'workspace-chat',
    title: '拿不准的句子，问右边',
    body: '「再短一点」「开场换成故事」「结尾加一句能被转述的话」——聊十轮它都记得你的场合、素材和当前稿子。',
    route: '/workspace',
    target: '[data-tour="workspace-chat"]',
    placement: 'left',
  },
  {
    key: 'revise-source',
    title: '旧稿也能单独体检',
    body: '贴进来点「诊断并改稿」，会看到逐条意见、改好的稿子和逐字差异。改哪里、为什么改，都写在旁边，采纳哪一句你说了算。',
    route: '/revise',
    target: '[data-tour="revise-source"]',
    placement: 'right',
  },
  {
    key: 'settings-model',
    title: '想让语气更像你，再接模型',
    body: '支持 OpenAI 兼容接口，不接也完全能用。档案、素材、草稿都只存在这台电脑的浏览器里。',
    route: '/settings',
    target: '[data-tour="settings-model"]',
    placement: 'bottom',
  },
  {
    key: 'settings-contact',
    title: '想要什么功能，直接找我',
    body: '缺一种场合、某个文件读不出来、改出来的句子不像你说话——都可以发邮件到 2631133172@qq.com，或者在 GitHub 上提 Issue。每一条建议我都会看。',
    route: '/settings',
    target: '[data-tour="settings-contact"]',
    placement: 'bottom',
    tip: '邮箱和仓库地址在每页页脚也留了一份。',
  },
  {
    key: 'finish',
    title: '就这些，去写第一篇吧',
    body: '挑一个最急的场合，把现有的 PPT 或旧稿丢进去，先拿到一版能开口的骨架。',
    target: null,
    route: null,
    tip: '以后想再看一遍，页脚有「使用引导」。',
  },
]
