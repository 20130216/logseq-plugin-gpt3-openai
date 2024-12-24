import { useState, useCallback, useEffect, useRef } from "react";
import { Combobox } from "@headlessui/react";
import { CommandOptions } from "./components/CommandOption";
import { CommandResult } from "./components/CommandResult";
import { CommandQuery } from "./lib/CommandQuery";
import { CommandButton } from "./components/CommandButton";
import { CommandToolbar } from "./components/CommandToolbar";
import { LoadingResult } from "./components/LoadingResult";
import { ErrorResult } from "./components/ErrorResult";
import { SuccessResult } from "./components/SuccessResult";

export interface Command {
  type: string;
  name: string;
  isParseJson: string;
  prompt: string;
  temperature?: number;
  shortcut?: string;
}

export type CommandState = ReadyState | SuccessState | ErrorState;

export interface ReadyState {
  status: "ready" | "loading";
}

export interface SuccessState {
  status: "success";
  result: string;
}

export interface ErrorState {
  status: "error";
  error: Error;
}

interface LogseqAIProps {
  commands: Command[];
  handleCommand: (command: Command, onContent: (content:string) => void) => Promise<string>;
  onInsert: (text: string) => void;
  onReplace: (text: string) => void;
  onClose: () => void;
}

export const LogseqAI: React.FC<LogseqAIProps> = ({ commands, handleCommand, onClose, onInsert, onReplace }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [commandState, setCommandState] = useState<CommandState>({
    status: "ready",
  });
  const [previousCommand, setPreviousCommand] = useState<Command | null>(null);

  const [query, setQuery] = useState("");
  const commandQuery = new CommandQuery(commands);

  async function runCommand(command: Command) {
    setPreviousCommand(command);
    setQuery(command.name);
    setCommandState({ status: "loading" });
    try {
      let result = "";
      await handleCommand(command, (content) => {
        result += content || "";
        setCommandState({ status: "success", result });
      });
      // setCommandState({ status: "success", result });
    } catch (e) {
      if (e instanceof Error) {
        setCommandState({ status: "error", error: e });
      } else {
        setCommandState({ status: "error", error: new Error("Unknown error") });
      }
    }
  }
  async function runPreviousCommand() {
    if (previousCommand) {
      await runCommand(previousCommand);
    }
  }

  function reset() {
    setQuery("");
    setCommandState({ status: "ready" });
  }

  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      if (commandState.status === "success" && event.key === "Enter") {
        onInsert(commandState.result);
        reset();
      }
    },
    [commandState]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
    };
  }, [handleKeyPress]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);
    firstElement?.focus();

    return () => {
      document.removeEventListener('keydown', handleTabKey);
    };
  }, []);

  useEffect(() => {
    searchInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  let result;
  if (commandState.status === "ready") {
    result = (
      <Combobox.Options
        className="max-h-40 overflow-y-auto flex flex-col"
        static
      >
        <CommandOptions commands={commandQuery.query(query)} />
      </Combobox.Options>
    );
  } else {
    const insertDisabled = commandState.status !== "success";
    const regenerateDisabled =
      commandState.status !== "success" && commandState.status !== "error";

    const commandToolbar = (
      <CommandToolbar
        left={
          <CommandButton
            disabled={regenerateDisabled}
            onClick={runPreviousCommand}
          >
            Regenerate
          </CommandButton>
        }
        right={
          <>
            <CommandButton
              disabled={insertDisabled}
              onClick={() => {
                commandState.status === "success" &&
                  onReplace(commandState.result);
                reset();
              }}
            >
              Replace
            </CommandButton>
            <CommandButton
              disabled={insertDisabled}
              onClick={() => {
                commandState.status === "success" &&
                  onInsert(commandState.result);
                reset();
              }}
            >
              Insert ⏎
            </CommandButton>
          </>
        }
      />
    );

    let commandResult;
    if (commandState.status === "loading") {
      commandResult = <LoadingResult />;
    } else if (commandState.status === "error") {
      commandResult = <ErrorResult message={commandState.error.message} />;
    } else if (commandState.status === "success") {
      commandResult = <SuccessResult result={commandState.result} />;
    }

    result = (
      <CommandResult toolbar={commandToolbar}>{commandResult}</CommandResult>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="logseq-ai-container"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logseq-ai-title"
    >
      <div className="search-container">
        <input
          ref={searchInputRef}
          type="text"
          id="logseq-openai-search"
          placeholder="Search commands..."
          className="search-input"
          tabIndex={0}
          aria-label="Search commands"
        />
      </div>

      <Combobox as="div" onChange={runCommand}>
        {result}
      </Combobox>

      <div className="button-container" role="group" aria-label="Action buttons">
        <button
          onClick={onClose}
          className="cancel-button"
          tabIndex={0}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
