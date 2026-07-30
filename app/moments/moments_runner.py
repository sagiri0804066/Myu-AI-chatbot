# app/moments_runner.py
import asyncio
import logging
import random
from .moments_generator import MomentsGeneratorEngine


async def start_moments_daemon():
    """
    独立的朋友圈后台中央时钟守护进程
    """
    logging.info("[守护进程] 朋友圈中央调度时钟正在初始化...")

    # 1. 实例化朋友圈引擎
    engine = MomentsGeneratorEngine()

    logging.info("[守护进程] 朋友圈中央调度时钟已拉起，开始执行周期判定。")

    while True:
        sleep = random.randint(600, 3600)
        logging.info(f"[守护进程] 朋友圈中央调度时钟下一次触发{sleep / 3600:.1f}小时后")
        await asyncio.sleep(sleep)

        try:
            # 2. 触发一次中央调度判定
            logging.info("[守护进程] 朋友圈中央调度时钟触发 Tick 判定...")
            success = await engine.run_central_scheduler_tick()
            if success:
                logging.info("[守护进程] 成功触发并发布了一条朋友圈动态。")
            else:
                logging.info("[守护进程] 本轮 Tick 判定未通过（可能处于全网发帖冷却期或随机未中）。")
        except Exception as e:
            logging.error(f"[守护进程] 朋友圈时钟 Tick 发生异常: {e}", exc_info=True)