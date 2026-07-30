import asyncio


class BufferHeap:
    def __init__(self):
        self.statusIndex = 0
        self._bell = None  # 初始设为 None，不立即创建

    @property
    def bell(self) -> asyncio.Event:
        """用属性装饰器确保 Event 在当前运行的 loop 中创建"""
        if self._bell is None:
            self._bell = asyncio.Event()
        return self._bell

    def ring(self):
        """敲钟"""
        # 注意：这里必须访问 self.bell 属性
        self.bell.set()

    def update_status(self, new_status: int):
        """更新状态并敲钟"""
        if self.statusIndex != new_status:
            self.statusIndex = new_status
            self.ring()

    async def wait_for_bell(self, timeout: float):
        """等待敲钟"""
        try:
            # 使用 asyncio.wait_for 等待 bell.wait()
            # 注意：在 Python 3.9 中，必须 catch asyncio.TimeoutError
            await asyncio.wait_for(self.bell.wait(), timeout=timeout)
            self.bell.clear()  # 收到信号后重置
            return True
        except asyncio.TimeoutError:
            return False
        except Exception as e:
            print(f"Bell Error: {e}")
            return False

# 实例化
heap = BufferHeap()