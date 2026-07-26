"""Services: orchestration and mapping.

A service may CALL the pipeline and RESHAPE its output. No service computes risk,
engineers a feature, decides a plan, or edits a verdict — those belong to `nexus.*`
and are treated here as a black box.
"""
