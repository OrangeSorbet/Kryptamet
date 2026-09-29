import time


class PipelineRecorder:
    """Collects an ordered list of PipelineEvents describing every discrete
    operation in an HE inference run, for frontend visualization/animation.
    """

    def __init__(self):
        self.events = []
        self._start_time = time.perf_counter()

    def emit(self, stage, operation_name, description, data_before=None, data_after=None, why="", next_step="", formal=""):
        self.events.append({
            "index": len(self.events),
            "stage": stage,
            "operation_name": operation_name,
            "description": description,
            "why": why,
            "next_step": next_step,
            "formal": formal,
            "data_before": data_before,
            "data_after": data_after,
            "elapsed_sec": time.perf_counter() - self._start_time,
        })

    def as_list(self):
        return self.events
