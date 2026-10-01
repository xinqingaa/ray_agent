"""English project segment; caller bounds summaries and freezes versions."""
def build_project_prompt_en(instructions, notes, notes_version, selected):
    return ('\n<project_context>\nProject instructions:\n' + (instructions or '(unset)')
            + f'\nProject notes (version {notes_version}):\n' + (notes or '(unset)')
            + '\nRecent conversation summaries (limited context, not complete history):\n' + '\n'.join(selected)
            + '\nProject files and conversations persist; browser logins and terminal state may not survive runs.'
            + '\nUse update_project_notes for reusable conclusions, decisions, pending work and important file locations '
              'when useful or at task completion. Do not log every turn or duplicate file contents.\n</project_context>\n')
