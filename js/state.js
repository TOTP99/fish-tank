// ================= 接口层: 跨域可变状态的唯一归属 =================
// 未来拆模块时每个对象整体搬入对应文件, 跨域只读/写这里, 不再满天飞全局 let。
//   Eco→sim.js  Sfx→audio.js  View→world.js  Stats/UI→ui.js  Creatures→creatures.js
const Eco   = { waste:0.22, quality:0.9, oxygen:0.85, filterOn:true,   // 生态数值
                dayNight:1, dayTarget:1,                                // 昼夜
                autoWaterCD:0, autoFeedCD:0, autoFishCD:0, autoTrimCD:0, // 自动任务冷却
                autoWatering:false };                                   // 自动换水进行中
const Sfx   = { on:true, ac:null, ambNodes:null };                     // 音频
const View  = { fx:true, hdOn:true, wreckBubbleT:0 };                   // 渲染开关 + 沉船气泡计时
const Stats = { achGot:{}, statClean:0, statWater:0 };                  // 成就统计
const UI    = { idleT:0, toastTimer:null, toastQ:[], hudT:0,            // 界面瞬态
                cfOk:null, obStep:0, saveT:0, firstFrame:true,
                pdown:null, lpTimer:null, lpFired:false };              // 手势
const Creatures = { genomeId:0 };                                      // 生物(鱼基因编号)

export {Creatures, Eco, Sfx, Stats, UI, View};
