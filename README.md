# Perfect Grade Display

This Chrome extension changes the grades displayed on the Waterloo LEARN
grades page. By default every row shows full marks (for example, `3/9` becomes
`9/9` and `85 %` becomes `100 %`). You can set a different grade and comment
for each row from the Chrome side panel. It changes only the page in your
browser; it does not change grades stored in LEARN.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder. If it was loaded before,
   click the reload button on its card.
4. Open or refresh your LEARN grades page.

## Customize grades

Click the extension's toolbar icon to open the side panel next to the grades
page. It lists every row in the grades table:

- **Grade**: type a percentage (`85`) or points (`17/20`). Empty rows use the
  **Default** at the top (100 unless you change it).
- **Comment**: replaces the row's Comments and Assessments cell. Leave it empty
  to keep the original comments; scores in them (like `Rubric 3 / 4`) still
  follow the row's grade.
- **Enabled**: untick to show the real grades again without losing your
  settings.

- **Feedback matches grade** (on by default): at full marks, the remark after
  each question's score is removed (`Part B: 20/20 - not diverse enough…`
  becomes `Part B: 20/20`). Below full marks the remarks stay, since they
  explain the lost marks. Overall comments without a score are not touched.
- **🎲 Randomize all grades**: gives every row a random whole-number grade
  from the chosen minimum (85 unless you change it) to 100. The grades go into
  the rows' boxes, so you can still edit any of them. Click again to re-roll.

Changes apply to the page as you type, and are saved for each course.

### Unsubmitted and ungraded work

Rows marked **Not submitted** or **Not graded** in the side panel keep their
real grade: the default, 🎲 Randomize and ✨ Fill all skip them. A grade you
type into the row yourself still applies.

- **Not submitted**: the Assignments page says "Not Submitted". The Grades
  page knows this too once you have opened the course's Assignments page,
  matching rows by name.
- **Not graded**: the row has no score yet (for example `- / 40`).

### Clean up feedback with Gemini

Rows whose feedback has question scores (like `Q4: 19/20- Only data sources
are missing.`) get a **✨ Clean up feedback** button. **✨ Fill all feedback
comments** does every row whose comment box is still empty. Either one fills the
comment box with the feedback minus the remarks after each score and any
criticism, with every score matching the row's grade (`Q4: 20/20` at 100).

This uses Gemini Nano, the model built into Chrome, which runs on your computer.
The first use downloads it, which takes a few minutes. Its answer is checked,
and if a question went missing, or Gemini isn't available on your computer, a
built-in rule that cuts everything after the score on each line is used
instead. The comment box is still editable afterwards, and scores in a custom
comment always follow the row's grade.

## Saving and backups

Settings are kept in `chrome.storage.local`, which is stored on disk: they
survive closing Chrome, restarting the computer and "Clear browsing data".
They are lost if you **remove the extension**, or if you **move or rename this
folder** (Chrome gives an unpacked extension a new ID, with empty storage, when
its path changes).

To be safe, use **Export backup** at the bottom of the side panel now and then,
and keep the file. **Import backup** restores it, replacing the saved settings
for the courses in the file. Other courses are kept.

## What changes

It runs on two LEARN pages (when the URL has an `ou` parameter):

- **Grades** (`/d2l/lms/grades/my_grades/main.d2l`)
- **Assignments** (`/d2l/lms/dropbox/user/folders_list.d2l`): the Score
  column, e.g. `39 / 40 - 97.5 %`. Due dates are left alone.

Rows are saved by name for each course, so an assignment and a grade item with
the same name share one setting.

In the Points, Weight Achieved, Grade and Comments and Assessments columns, the
extension rewrites fractions (`8.5 / 10`, `7 out of 10`) and percentages
(`85 %`), including ones split across HTML elements. Letter grades are not
changed. If the page has no recognizable grades table, every fraction and
percentage on the page is set to the default instead.

## Tests

```
npm install
npm test
```
