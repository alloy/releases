// @ts-check

const https = require("https");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const util = require("util");

const readFile = util.promisify(fs.readFile);

const {
  fetchCommits,
  generateChangelog,
  getChangeMessage,
  getOriginalCommit,
  getFirstCommitAfterForkingFromMaster,
} = require("../changelog-generator");

const RN_REPO = process.env.RN_REPO;
if (!process.env.RN_REPO) {
  throw new Error(
    "[!] Specify the path to a checkout of the react-native repo with the `RN_REPO` env variable."
  );
}

describe(getOriginalCommit, () => {
  it("returns a cherry-picked community commit with the `sha` updated to point to the original in the `master` branch", () => {
    return getOriginalCommit(RN_REPO, {
      sha: "474861f4e7aa0c5314081444edaee48d2faea1b6",
      commit: {
        message: "A community picked commit\n\nDifferential Revision: D17285473"
      },
      author: { login: "janicduplessis" }
    }).then(commit => {
      expect(commit).toEqual({
        sha: "2c1913f0b3d12147654501f7ee43af1d313655d8",
        commit: {
          message:
            "A community picked commit\n\nDifferential Revision: D17285473"
        },
        author: { login: "janicduplessis" }
      });
    });
  });
});

describe(getFirstCommitAfterForkingFromMaster, () => {
  it("returns the SHA of the first commit where its first parent is on the master branch", () => {
    return getFirstCommitAfterForkingFromMaster(RN_REPO, "v0.61.5").then(sha => {
      expect(sha).toEqual("bb625e523867d3b8391a76e5aa7c22c081036835");
    })
  });
});

/**
 * @param {string} fixture 
 */
function requestWithFixtureResponse(fixture) {
  const requestEmitter = new EventEmitter();
  const responseEmitter = new EventEmitter();
  responseEmitter["statusCode"] = 200;
  responseEmitter["headers"] = { link: 'rel="next"' };
  setImmediate(() => {
    requestEmitter.emit("response", responseEmitter);
    readFile(
      path.join(__dirname, "__fixtures__", fixture),
      "utf-8"
    ).then(data => {
      responseEmitter.emit("data", data);
      responseEmitter.emit("end");
    });
  });
  return requestEmitter
}

describe(fetchCommits, () => {
  it("paginates back from `compare` to `base`", () => {
    // The first commit in commits-v0.60.5-page-2.json, which is the 31st commit
    const base = "99bc31cfa609e838779c29343684365a2ed6169f";
    // The first commit in commits-v0.60.5-page-1.json, which is the last, chronologically
    const compare = "35300147ca66677f42e8544264be72ac0e9d1b45";

    const getMock = jest.fn(uri => {
      if (uri.path === `/repos/facebook/react-native/commits?sha=${compare}&page=1`) {
        return requestWithFixtureResponse("commits-v0.60.5-page-1.json");
      } else if (uri.path === `/repos/facebook/react-native/commits?sha=${compare}&page=2`) {
        return requestWithFixtureResponse("commits-v0.60.5-page-2.json");
      } else {
        throw new Error(`Unexpected request: ${uri.path}`);
      }
    });
    Object.defineProperty(https, "get", { value: getMock });

    return fetchCommits("authn-token", base, compare).then(commits => {
      expect(commits.length).toEqual(31); // 1 full page of 30 commits + 1 commit of 2nd page
      expect(commits[0].sha).toEqual("35300147ca66677f42e8544264be72ac0e9d1b45");
      expect(commits[30].sha).toEqual("99bc31cfa609e838779c29343684365a2ed6169f");
    });
  });
})

describe(getChangeMessage, () => {
  it("works", () => {
    expect(
      getChangeMessage({
        sha: "abcd1234",
        commit: {
          message:
            "Some ignored commit message\n\n[iOS] [Fixed] - Some great fixes! (#42)"
        },
        author: { login: "alloy" }
      })
    ).toEqual(
      "- Some great fixes! ([abcd123](https://github.com/facebook/react-native/commit/abcd123) by [@alloy](https://github.com/alloy))"
    );
  });
});

xdescribe(generateChangelog, () => {
  it("works", () => {
    const requestEmitter = new EventEmitter();
    const responseEmitter = new EventEmitter();
    const responseData = fs.readFileSync(
      path.join(__dirname, "__fixtures__/v0.60.4...v0.60.5.json"),
      "utf-8"
    );

    const getMock = jest.fn(uri => {
      if (
        uri.path !== "/repos/facebook/react-native/compare/v0.60.4...v0.60.5"
      ) {
        throw new Error(`Unexpected request: ${uri.path}`);
      }
      return requestEmitter;
    });
    Object.defineProperty(https, "get", { value: getMock });

    const result = generateChangelog({
      gitDir: RN_REPO,
      existingChangelogData:
        "- Bla bla bla ([ffdf3f2](https://github.com/facebook/react-native/commit/ffdf3f2)",
      base: "v0.60.4",
      compare: "v0.60.5"
    });

    requestEmitter.emit("response", responseEmitter);
    responseEmitter.emit("data", responseData);
    responseEmitter.emit("end");

    return result.then(changelog => {
      expect(changelog).toMatchSnapshot();
    });
  });
});
