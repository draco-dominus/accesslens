
<div align="center">

# AccessLens

### Notice what others might miss.

**An AI-powered accessibility inspection companion that helps identify potential barriers, understand their impact, and verify improvements.**

🏆 **Winner — Best Use of the Google Gemini API**  
**Major League Hacking · Fall Hacks 2026**

[Live Demo](https://accesslens-eight-sigma.vercel.app/) · [Devpost](https://devpost.com/software/accesslens-byl64p) · [Source Code](https://github.com/draco-dominus/accesslens)

</div>

---

## The Problem

Accessibility barriers don't always require major renovations to address. Sometimes, something as simple as a chair obstructing a walkway can make a space more difficult to navigate.

The challenge is recognizing these barriers before someone encounters them.

**AccessLens helps make accessibility awareness proactive rather than reactive.**

Designed for small businesses, facilities teams, and people responsible for shared environments, AccessLens turns an ordinary smartphone photo into the beginning of an actionable inspection workflow.

## What AccessLens Does

AccessLens goes beyond one-off AI image analysis. It helps users move from identifying a potential problem to understanding, addressing, and documenting it.

### 1. Scan your surroundings
Capture or upload a photograph of a physical space. Multimodal AI analyzes the image for potential accessibility barriers and generates structured findings.

### 2. Understand findings with Lumi
Ask Lumi, the contextual AI sidekick, questions about identified barriers.

Rather than responding with only generic advice, Lumi uses the inspection's recorded findings to explain potential impacts and suggest practical next steps.

### 3. Re-check an area
After making a change, photograph the same area again.

A dedicated AI comparison pipeline evaluates whether the images show the same location and whether the original concern appears to have improved.

### 4. Compare before and after
Review changes using an interactive before-and-after slider, with uncertainty preserved when the evidence is insufficient.

### 5. Export an inspection report
Generate a shareable PDF containing inspection findings, observations, and supporting photographs.

## Technical Stack

| Layer | Technologies |
|---|---|
| Application | Next.js, React, TypeScript |
| Styling | Tailwind CSS |
| AI integration | Google GenAI SDK |
| Vision analysis | Gemma and Gemini multimodal models |
| Conversational AI | Gemini |
| Response validation | Zod |
| Image processing | Sharp, HEIC decoding |
| Local persistence | localStorage, IndexedDB |
| Deployment | Vercel |
| Design prototyping | Figma Make |

## Architecture

AccessLens separates different AI responsibilities rather than relying on a single prompt for the entire workflow.

```text
                    AccessLens
                 Mobile Web Client
                        |
                 Next.js API Routes
                        |
          +-------------+-------------+
          |             |             |
          v             v             v
    Image Analysis   Re-check       Ask Lumi
        Pipeline     Pipeline         Chat
          |             |             |
      Multimodal     Scene and      Inspection-
      AI Models      Change AI      Grounded AI
          |             |             |
          +-------------+-------------+
                        |
                 Validated Results
                        |
                Inspection State
                        |
              +---------+---------+
              |                   |
          Local Storage       IndexedDB
          Session Data        Photographs
                        |
                 PDF Reporting
```

### Structured multimodal analysis

Photographs are processed through a specialized image-analysis pipeline that identifies potential physical accessibility barriers.

Model responses are validated against application schemas using Zod before becoming structured inspection findings.

### Persistent inspection sessions

The application maintains relationships between inspected areas, photographs, findings, and subsequent re-checks.

This allows users to revisit specific locations instead of treating every photograph as an unrelated AI request.

### Evidence-based before-and-after comparison

Detecting an object and determining whether an accessibility concern has been addressed are different technical problems.

AccessLens uses a dedicated comparison workflow to evaluate:

- Whether two photographs depict the same physical area.
- Whether the original concern remains adequately visible.
- Whether the available evidence supports a meaningful change.
- Whether the finding's status can be updated without overstating certainty.

Inconclusive results are not automatically treated as resolved issues.

### Contextual conversational AI

Lumi receives bounded, structured context from an inspection's recorded findings.

This allows multi-turn questions about observations, potential impacts, and suggested improvements without requiring every photograph to be resent during each conversation.

### Reliability and safeguards

AI-generated conclusions are inherently uncertain, particularly when photographs provide incomplete spatial information.

AccessLens incorporates:

- Schema validation for structured model outputs.
- Separate analysis and comparison pipelines.
- Conservative status transitions.
- Bounded model requests and error handling.
- API request limits.
- Explicit uncertainty when verification is inconclusive.

The goal is to build a useful inspection assistant without presenting AI observations as definitive assessments.

## Why Not Just Use Gemini?

Gemini can already analyze photographs and answer questions about potential accessibility concerns.

**AccessLens builds the application layer around that intelligence.**

Rather than requiring users to manually manage photographs, prompts, findings, comparisons, and reports, AccessLens provides a connected workflow:

**Scan → Understand → Improve → Re-check → Document**

The technical value lies in structured inspection state, specialized AI pipelines, contextual conversation, evidence-based comparisons, and an interface designed for real-world use.

AccessLens is not a new foundation model. It is a purpose-built product that makes existing multimodal AI capabilities more actionable.

## Getting Started

### Prerequisites

- Node.js and npm
- A Google Gemini API key with access to the configured models

### Installation

Clone the repository:

```bash
git clone https://github.com/draco-dominus/accesslens.git
cd accesslens
```

Install dependencies:

```bash
npm install
```

Configure your local environment in `.env.local`:

```env
GEMINI_API_KEY=your_api_key_here
```

Never commit your real API key to the repository.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Available Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run automated tests |

Model availability, API quotas, and access requirements may vary.

## Privacy and Limitations

AccessLens is a prototype intended to support preliminary accessibility awareness and inspection.

- It does **not** replace professional accessibility audits.
- It does **not** certify compliance with accessibility standards or building codes.
- An image with no detected findings does not establish that a space is accessible.
- Image analysis may miss barriers or produce incorrect observations.
- Inspection data and photographs are stored locally in the browser, while selected images are transmitted to cloud AI services for analysis.
- Inspection history is not automatically synchronized across devices.

Future development could include validated spatial localization, broader accessibility assessments, collaborative inspection workflows, and evaluation with accessibility professionals.

## Development Process

AccessLens was independently conceived, designed, developed, tested, and presented as a solo project during Fall Hacks 2026.

Development followed an AI-assisted engineering workflow:

- **Claude Code:** Implementation and iterative development.
- **OpenAI Codex:** Independent code review, verification, and QA.
- **Human-led engineering:** Product direction, requirements, architecture decisions, testing, debugging, and user experience.

The process combined AI-assisted implementation with independent review and real-device testing to rapidly deliver a complete working product.

## Recognition

🏆 **Best Use of the Google Gemini API — Fall Hacks 2026**

Awarded at Major League Hacking's Fall Hacks 2026.

[View the Devpost submission](https://devpost.com/software/accesslens-byl64p)

## Author

Built by **Draco Dominus**.

*I like building things that make life easier.*

