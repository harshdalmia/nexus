"""Transport models.

These are *views* over pipeline output. They never add analytical fields: every value is
either copied from a pipeline model, or is a presentation-only derivation (a label, an
ordering, a count of things the pipeline already returned).
"""
