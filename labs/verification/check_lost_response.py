"""确定性模拟：先记账，再丢失一次响应。演示去重条件，不实现网络协议。"""
import json


class SimulatedService:
    def __init__(self, deduplicate):
        self.deduplicate = deduplicate
        self.effects = []
        self.receipts = {}
        self.drop_next_reply = True

    def submit(self, key):
        if self.deduplicate and key in self.receipts:
            return self.receipts[key]
        receipt = f'receipt-{len(self.effects) + 1}'
        self.effects.append({'key': key, 'receipt': receipt})
        self.receipts[key] = receipt
        if self.drop_next_reply:
            self.drop_next_reply = False
            raise TimeoutError('动作已完成，模拟响应丢失')
        return receipt


def run_case(deduplicate, reuse_key):
    service = SimulatedService(deduplicate)
    attempts = 0
    known_receipt = None
    for key in ['operation-1', 'operation-1' if reuse_key else 'operation-2']:
        attempts += 1
        try:
            known_receipt = service.submit(key)
            break
        except TimeoutError:
            # 这里只为了对照重试效果，不代表业务系统应当自动重试。
            pass
    return {'server_deduplicates': deduplicate, 'reuses_key': reuse_key,
            'requests': attempts, 'effects': len(service.effects),
            'known_receipt': known_receipt, 'ledger': service.effects}


def main():
    for deduplicate, reuse_key, expected in [(False, True, 2), (True, True, 1), (True, False, 2)]:
        result = run_case(deduplicate, reuse_key)
        assert result['requests'] == 2 and result['effects'] == expected
        print(json.dumps(result, ensure_ascii=False))
    print('相同响应丢失位置：仅重用 ID 不够；服务端去重与稳定业务键须配合。')
    print('单线程内存模拟，不证明事务原子性、重启后去重或 RayAgent 自动恢复。')


if __name__ == '__main__':
    main()
