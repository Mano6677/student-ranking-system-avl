
#define MAX_NAME 48
#define MAX_STUDENTS 512
#define MAX_EVENTS 16
struct Student {
    int rollNo;
    char name[MAX_NAME];
    int marks;
    Student* left;
    Student* right;
    int height;
};
static Student pool[MAX_STUDENTS];
static int poolUsed = 0;
static int liveCount = 0;

static int lastError = 0;       
static int lastActionType = 0;  
static int lastTriggerMarks = 0;

static int evCase[MAX_EVENTS];      
static int evY[MAX_EVENTS], evX[MAX_EVENTS], evZ[MAX_EVENTS];
static int evBalance[MAX_EVENTS], evLeftH[MAX_EVENTS], evRightH[MAX_EVENTS];
static int evChildBalance[MAX_EVENTS]; 

static int myMax(int a, int b) { return a > b ? a : b; }
static int height(Student* n) { return n ? n->height : 0; }
static int getBalance(Student* n) { return n ? height(n->left) - height(n->right) : 0; }

static void copyName(char* dst, const char* src) {
    int i = 0;
    for (; i < MAX_NAME - 1 && src[i] != 0; i++) dst[i] = src[i];
    dst[i] = 0;
}
static void copyStudentData(Student* dst, Student* src) {
    dst->rollNo = src->rollNo;
    copyName(dst->name, src->name);
    dst->marks = src->marks;
}

static void recordRotation(int c, int y, int x, int z, int bal, int lh, int rh, int childBal) {
    if (evCount < MAX_EVENTS) {
        evCase[evCount] = c; evY[evCount] = y; evX[evCount] = x; evZ[evCount] = z;
        evBalance[evCount] = bal; evLeftH[evCount] = lh; evRightH[evCount] = rh;
        evChildBalance[evCount] = childBal;
        evCount++;
    }
}

static Student* createStudent(int rollNo, const char* name, int marks) {
    if (poolUsed >= MAX_STUDENTS) { lastError = 2; return 0; }
    Student* n = &pool[poolUsed++];
    n->rollNo = rollNo;
    copyName(n->name, name);
    n->marks = marks;
    n->left = 0; n->right = 0; n->height = 1;
    liveCount++;
    return n;
}

static Student* rightRotate(Student* y) {
    Student* x = y->left;
    Student* t2 = x->right;
    x->right = y; y->left = t2;
    y->height = myMax(height(y->left), height(y->right)) + 1;
    x->height = myMax(height(x->left), height(x->right)) + 1;
    return x;
}
static Student* leftRotate(Student* x) {
    Student* y = x->right;
    Student* t2 = y->left;
    y->left = x; x->right = t2;
    x->height = myMax(height(x->left), height(x->right)) + 1;
    y->height = myMax(height(y->left), height(y->right)) + 1;
    return y;
}

static Student* insertNode(Student* root, int rollNo, const char* name, int marks) {
    if (root == 0) return createStudent(rollNo, name, marks);

    if (marks < root->marks) {
        root->left = insertNode(root->left, rollNo, name, marks);
    } else if (marks > root->marks) {
        root->right = insertNode(root->right, rollNo, name, marks);
    } else {
        lastError = 1; // Duplicate marks not allowed!
        return root;
    }

    root->height = 1 + myMax(height(root->left), height(root->right));
    int balance = getBalance(root);

    if (balance > 1 && marks < root->left->marks) {
        recordRotation(1, root->marks, root->left->marks, -1, balance, height(root->left), height(root->right), 0);
        return rightRotate(root);
    }
    if (balance < -1 && marks > root->right->marks) {
        recordRotation(2, root->marks, root->right->marks, -1, balance, height(root->left), height(root->right), 0);
        return leftRotate(root);
    }
    if (balance > 1 && marks > root->left->marks) {
        int z = root->left->right ? root->left->right->marks : -1;
        recordRotation(3, root->marks, root->left->marks, z, balance, height(root->left), height(root->right), 0);
        root->left = leftRotate(root->left);
        return rightRotate(root);
    }
    if (balance < -1 && marks < root->right->marks) {
        int z = root->right->left ? root->right->left->marks : -1;
        recordRotation(4, root->marks, root->right->marks, z, balance, height(root->left), height(root->right), 0);
        root->right = rightRotate(root->right);
        return leftRotate(root);
    }
    return root;
}


static Student* minValueNode(Student* node) {
    Student* cur = node;
    while (cur && cur->left != 0) cur = cur->left;
    return cur;
}

static Student* deleteByMarks(Student* root, int marks) {
    if (root == 0) return root;

    if (marks < root->marks) {
        root->left = deleteByMarks(root->left, marks);
    } else if (marks > root->marks) {
        root->right = deleteByMarks(root->right, marks);
    } else {
        if (root->left == 0 || root->right == 0) {
            Student* child = root->left ? root->left : root->right;
            if (child == 0) {
                root = 0; 
            } else {
                copyStudentData(root, child); 
                root->left = child->left;
                root->right = child->right;
                root->height = child->height;
            }
        } else {
            Student* succ = minValueNode(root->right); // in-order successor
            copyStudentData(root, succ);
            root->right = deleteByMarks(root->right, succ->marks);
        }
    }
    if (root == 0) return root;
    root->height = 1 + myMax(height(root->left), height(root->right));
    int balance = getBalance(root);

    if (balance > 1 && getBalance(root->left) >= 0) {
        recordRotation(1, root->marks, root->left->marks, -1, balance, height(root->left), height(root->right), getBalance(root->left));
        return rightRotate(root);
    }
    if (balance > 1 && getBalance(root->left) < 0) {
        int z = root->left->right ? root->left->right->marks : -1;
        recordRotation(3, root->marks, root->left->marks, z, balance, height(root->left), height(root->right), getBalance(root->left));
        root->left = leftRotate(root->left);
        return rightRotate(root);
    }
    if (balance < -1 && getBalance(root->right) <= 0) {
        recordRotation(2, root->marks, root->right->marks, -1, balance, height(root->left), height(root->right), getBalance(root->right));
        return leftRotate(root);
    }

    if (balance < -1 && getBalance(root->right) > 0) {
        int z = root->right->left ? root->right->left->marks : -1;
        recordRotation(4, root->marks, root->right->marks, z, balance, height(root->left), height(root->right), getBalance(root->right));
        root->right = rightRotate(root->right);
        return leftRotate(root);
    }
    return root;
}

static Student* searchNode(Student* root, int rollNo) {
    if (root == 0) return 0;
    if (root->rollNo == rollNo) return root;
    Student* l = searchNode(root->left, rollNo);
    if (l) return l;
    return searchNode(root->right, rollNo);
}
static Student* findTopperNode(Student* root) {
    if (root == 0) return 0;
    while (root->right != 0) root = root->right;
    return root;
}

static int rankingBuf_roll[MAX_STUDENTS];
static char rankingBuf_name[MAX_STUDENTS][MAX_NAME];
static int rankingBuf_marks[MAX_STUDENTS];
static int rankingCount = 0;
static void rankingWalk(Student* root) {
    if (root == 0) return;
    rankingWalk(root->right);
    rankingBuf_roll[rankingCount] = root->rollNo;
    copyName(rankingBuf_name[rankingCount], root->name);
    rankingBuf_marks[rankingCount] = root->marks;
    rankingCount++;
    rankingWalk(root->left);
}

static int treeBuf[MAX_STUDENTS * 5];
static int treeBufCount = 0;
static Student* g_root = 0;
static void treeWalk(Student* node) {
    if (node == 0) return;
    int b = treeBufCount * 5;
    treeBuf[b+0] = node->rollNo;
    treeBuf[b+1] = node->marks;
    treeBuf[b+2] = node->left ? node->left->rollNo : -1;
    treeBuf[b+3] = node->right ? node->right->rollNo : -1;
    treeBuf[b+4] = (node == g_root) ? 1 : 0;
    treeBufCount++;
    treeWalk(node->left);
    treeWalk(node->right);
}
static char treeNameBuf[MAX_STUDENTS][MAX_NAME];
static int treeNameWalkIdx;
static void treeNameWalk(Student* node) {
    if (node == 0) return;
    copyName(treeNameBuf[treeNameWalkIdx++], node->name);
    treeNameWalk(node->left);
    treeNameWalk(node->right);
}

static Student* root = 0;
static char nameScratch[MAX_NAME];

extern "C" {

__attribute__((visibility("default"))) char* getNameScratchPtr() { return nameScratch; }

__attribute__((visibility("default")))
int addStudent(int rollNo, int marks) {
    lastError = 0; evCount = 0; lastActionType = 0; lastTriggerMarks = marks;
    root = insertNode(root, rollNo, nameScratch, marks);
    return lastError;
}

__attribute__((visibility("default")))
int deleteStudent(int rollNo) {
    Student* found = searchNode(root, rollNo);
    if (!found) return 0;
    int delMarks = found->marks;
    evCount = 0; lastActionType = 1; lastTriggerMarks = delMarks;
    root = deleteByMarks(root, delMarks);
    liveCount--;
    return 1;
}

__attribute__((visibility("default"))) int getLastActionType() { return lastActionType; }
__attribute__((visibility("default"))) int getLastTriggerMarks() { return lastTriggerMarks; }

__attribute__((visibility("default"))) int getRotationEventCount() { return evCount; }
__attribute__((visibility("default"))) int getRotationEventCase(int i) { return evCase[i]; }
__attribute__((visibility("default"))) int getRotationEventY(int i) { return evY[i]; }
__attribute__((visibility("default"))) int getRotationEventX(int i) { return evX[i]; }
__attribute__((visibility("default"))) int getRotationEventZ(int i) { return evZ[i]; }
__attribute__((visibility("default"))) int getRotationEventBalance(int i) { return evBalance[i]; }
__attribute__((visibility("default"))) int getRotationEventLeftH(int i) { return evLeftH[i]; }
__attribute__((visibility("default"))) int getRotationEventRightH(int i) { return evRightH[i]; }
__attribute__((visibility("default"))) int getRotationEventChildBalance(int i) { return evChildBalance[i]; }

__attribute__((visibility("default"))) int getTreeHeight() { return height(root); }
__attribute__((visibility("default"))) int getStudentCount() { return liveCount; }

__attribute__((visibility("default")))
int computeRanking() {
    rankingCount = 0;
    rankingWalk(root);
    return rankingCount;
}
__attribute__((visibility("default"))) int rankingRollAt(int i) { return rankingBuf_roll[i]; }
__attribute__((visibility("default"))) int rankingMarksAt(int i) { return rankingBuf_marks[i]; }
__attribute__((visibility("default"))) char* rankingNamePtrAt(int i) { return rankingBuf_name[i]; }
static int searchRoll, searchMarks;
static char searchNameOut[MAX_NAME];
__attribute__((visibility("default")))
int searchStudentByRoll(int rollNo) {
    Student* s = searchNode(root, rollNo);
    if (!s) return 0;
    searchRoll = s->rollNo; searchMarks = s->marks;
    copyName(searchNameOut, s->name);
    return 1;
}
__attribute__((visibility("default"))) int getSearchRoll() { return searchRoll; }
__attribute__((visibility("default"))) int getSearchMarks() { return searchMarks; }
__attribute__((visibility("default"))) char* getSearchNamePtr() { return searchNameOut; }
static int topperRoll, topperMarks;
static char topperNameOut[MAX_NAME];
__attribute__((visibility("default")))
int findTopper() {
    Student* t = findTopperNode(root);
    if (!t) return 0;
    topperRoll = t->rollNo; topperMarks = t->marks;
    copyName(topperNameOut, t->name);
    return 1;
}
__attribute__((visibility("default"))) int getTopperRoll() { return topperRoll; }
__attribute__((visibility("default"))) int getTopperMarks() { return topperMarks; }
__attribute__((visibility("default"))) char* getTopperNamePtr() { return topperNameOut; }
__attribute__((visibility("default")))
int exportTree() {
    g_root = root;
    treeBufCount = 0;
    treeWalk(root);
    treeNameWalkIdx = 0;
    treeNameWalk(root);
    return treeBufCount;
}
__attribute__((visibility("default"))) int* getTreeBufPtr() { return treeBuf; }
__attribute__((visibility("default"))) char* treeNamePtrAt(int i) { return treeNameBuf[i]; }
__attribute__((visibility("default")))
void resetAll() {
    poolUsed = 0; liveCount = 0; root = 0; g_root = 0;
    rankingCount = 0; treeBufCount = 0; evCount = 0;
}
} 
