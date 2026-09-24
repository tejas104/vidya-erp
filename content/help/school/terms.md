# Academic terms and assessment types

Academic terms set the dates and assessment configuration used by the school marks workflow. They are not college semesters.

## Who can use this

Administrators with access to the school can create terms, configure assessment types, close a term, and reopen it. Principals can view the term register but cannot make these changes. Other staff only see terms that their existing access permits; they cannot use the register to change the school calendar.

## Before you start

Choose the Academic Year, term name, and start and end dates with the school administration. For assessment types, agree the complete percentage distribution before teachers create assessments. A grade scale must also already exist before a teacher can create the first assessment for a term.

## Create an academic term

1. Open **Academic terms** from the sidebar.
2. Enter or select the **Academic Year** filter, then select **Create term**.
3. Select the **School**, enter the **Term name**, **Academic Year**, **Start date**, and **End date**.
4. Select **Create term**.

The new term is open and appears in the term register. It can be used to set up assessment types and, after a grade scale is available, to create assessments.

If the end date is before the start date, correct the dates before saving. If a term with the same name already exists for that Academic Year, use the existing term or choose the correct name instead of creating a duplicate.

## Configure assessment types

1. In the term register, select **Assessment types** for an open term.
2. Select **Add assessment type** for every type the school uses, such as Unit Test, Practical, or Annual Exam.
3. Enter each **Type name** and **weight (%)**.
4. Check **Total weight**. Every name must be unique, each weight must be a whole percentage, and the total must be exactly 100%.
5. Select **Save assessment types**.

The saved distribution is available when a teacher creates an assessment for that term. Do not treat the percentages as a report-card calculation or publication feature; this screen only configures the assessment distribution used by the implemented marks workflow.

Assessment types cannot be changed while the term is closed. They are also fixed once an assessment uses the weighting plan, including after the term is reopened, so recorded grades remain reproducible. If the editor says the configuration changed, reload the term before trying again.

## Close or reopen a term

1. When marking for the term is complete, select **Close term** in the term register.
2. Review the term and optionally record a **Closure reason**.
3. Select **Confirm closure**.

Closing a term makes its assessment marks read-only and releases the current term results to linked students and guardians whose relationship includes marks access. Review scores before closing. Missing marks display as incomplete, never as zero. Teachers can still view recorded marks and grades, but cannot create assessments or correct marks for that term. Report-card PDFs have a separate publication step.

Terms that were already closed before this feature was introduced remain **Marks private**. After reviewing scores, an administrator can select **Release marks** and confirm the release. This action is recorded in the audit log; it is available only for closed terms that have not yet been released.

To make a correction, an administrator must select **Reopen term**, enter a non-blank **Reopening reason**, and select **Confirm reopening**. Reopening hides the term results from the student and family marks views while the correction is in progress. Close the term again to release the corrected result. The reason and transition are recorded in the audit log. If the term was already changed by another administrator, reload the register and review its current status before trying again.
